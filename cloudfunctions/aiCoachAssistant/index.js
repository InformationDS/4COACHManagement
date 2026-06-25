const cloud = require("wx-server-sdk");
const modelAdapter = require("./lib/modelAdapter");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const INTENTS = {
  QUERY_TODAY_LESSONS: "query_today_lessons",
  QUERY_STUDENT: "query_student",
  CREATE_LESSON: "create_lesson",
  GENERATE_TRAINING_PLAN: "generate_training_plan",
  SAVE_LESSON_SUMMARY: "save_lesson_summary",
  OTHER: "other"
};

const WRITE_INTENTS = [
  INTENTS.CREATE_LESSON,
  INTENTS.GENERATE_TRAINING_PLAN,
  INTENTS.SAVE_LESSON_SUMMARY
];

const INTENT_TO_ACTION = {
  create_lesson: { actionType: "create_lesson", cardType: "schedule_confirm_card" },
  generate_training_plan: { actionType: "save_training_plan", cardType: "training_plan_confirm_card" },
  save_lesson_summary: { actionType: "save_lesson_summary", cardType: "lesson_summary_confirm_card" }
};

const VALID_INTENTS = Object.keys(INTENT_TO_ACTION).concat([
  INTENTS.QUERY_TODAY_LESSONS,
  INTENTS.QUERY_STUDENT,
  INTENTS.OTHER
]);

const MISSING_SLOT_WHITELIST = [
  "student_name",
  "date_text",
  "start_time_text",
  "end_time_text",
  "location",
  "lesson_id",
  "lesson_ref_text",
  "training_theme",
  "summary_text"
];

const FORBIDDEN_RE = /(充值|扣课时|扣减课时|删除|通知学员|自动完课|自动扣|导出|模型|额度|批量)/;
const CANCEL_RE = /^(算了|不用了|取消|取消排课|取消任务|重新来|重来|先不弄了)$/;

function fail(error_code, error_message) {
  return { success: false, type: "error", error_code, error_message, text: error_message };
}

async function ensureCoach(openid) {
  const res = await db.collection("users").where({ openid, role: "coach" }).limit(1).get();
  return !!res.data.length;
}

function textResponse(type, text, extra) {
  return Object.assign({
    success: true,
    messageId: `ai_${Date.now()}`,
    type,
    text,
    card: null,
    evidence: [],
    usage: null
  }, extra || {});
}

function cardResponse(text, card, extra) {
  return textResponse("answer", text || "", Object.assign({ card }, extra || {}));
}

async function safeGet(promise, fallback, label) {
  try {
    return await promise;
  } catch (error) {
    console.warn(`${label || "database"} failed`, error);
    return fallback;
  }
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, "");
}

function formatTime(date) {
  const value = date instanceof Date ? date : new Date(date);
  const h = value.getHours() < 10 ? `0${value.getHours()}` : `${value.getHours()}`;
  const m = value.getMinutes() < 10 ? `0${value.getMinutes()}` : `${value.getMinutes()}`;
  return `${h}:${m}`;
}

function formatDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  const m = value.getMonth() + 1;
  const d = value.getDate();
  return `${value.getFullYear()}-${m < 10 ? `0${m}` : m}-${d < 10 ? `0${d}` : d}`;
}

function dateLabel(date) {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getMonth() + 1}月${value.getDate()}日`;
}

function startOfDay(date) {
  const value = new Date(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
}

function endOfDay(date) {
  const start = startOfDay(date);
  return new Date(start.getTime() + 24 * 60 * 60000 - 1);
}

function addMinutes(time, minutes) {
  const parts = String(time || "").split(":").map(Number);
  const date = new Date(2026, 0, 1, parts[0], parts[1] + minutes);
  return formatTime(date);
}

function timeToMinutes(value) {
  const parts = String(value || "").split(":").map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

function durationToUnits(minutes) {
  if (minutes <= 30) return 0.5;
  if (minutes <= 60) return 1;
  if (minutes <= 90) return 1.5;
  return 2;
}

function parseDateTime(dateText, timeText) {
  const parts = String(dateText || "").split("-").map(Number);
  const time = String(timeText || "").split(":").map(Number);
  if (parts.length !== 3 || time.length < 2) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], time[0], time[1], 0, 0);
}

function chineseHour(value) {
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  return map[value] || 0;
}

function chineseMinute(value) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (value === "十五") return 15;
  if (value === "二十") return 20;
  if (value === "三十") return 30;
  if (value === "四十") return 40;
  if (value === "五十") return 50;
  if (value.length === 2 && value[0] === "十") return 10 + (map[value[1]] || 0);
  if (value.length === 2 && value[1] === "十") return (map[value[0]] || 0) * 10;
  if (value.length === 3 && value[1] === "十") return (map[value[0]] || 0) * 10 + (map[value[2]] || 0);
  return map[value] || 0;
}

function parseTime(text) {
  const value = String(text || "");
  const explicit = value.match(/(\d{1,2})[:：点](\d{1,2})?/);
  const chinese = value.match(/([一二两三四五六七八九十十一十二])点(?:半|([一二三四五六七八九十]{1,3})分?)?/);
  if (!explicit && !chinese) return null;
  let hour = explicit ? Number(explicit[1]) : chineseHour(chinese[1]);
  let minute = explicit && explicit[2] ? Number(explicit[2]) : 0;
  if (chinese && chinese[0].includes("半")) minute = 30;
  if (chinese && chinese[2]) minute = chineseMinute(chinese[2]);
  if (/下午|晚上/.test(value) && hour < 12) hour += 12;
  if (/中午/.test(value) && hour < 11) hour += 12;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${hour < 10 ? `0${hour}` : hour}:${minute < 10 ? `0${minute}` : minute}`;
}

function parseEndTime(text) {
  const value = String(text || "");
  const range = value.match(/(?:到|至|-|—|~)\s*(下午|晚上|中午)?\s*(\d{1,2})[:：点](\d{1,2})?/);
  if (!range) return null;
  const phrase = `${range[1] || ""}${range[2]}:${range[3] || "00"}`;
  return parseTime(phrase);
}

function parseTargetDate(text, clientTime) {
  const value = String(text || "");
  const base = clientTime ? new Date(clientTime) : new Date();
  const target = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  if (/后天/.test(value)) target.setDate(target.getDate() + 2);
  else if (/明天/.test(value)) target.setDate(target.getDate() + 1);
  else if (/今天|今日|当天/.test(value)) target.setDate(target.getDate());
  else if (!/(\d{1,2})月(\d{1,2})日?/.test(value) && !/(\d{4})-(\d{1,2})-(\d{1,2})/.test(value)) return "";
  const ymd = value.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return formatDate(new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
  const md = value.match(/(\d{1,2})月(\d{1,2})日?/);
  if (md) target.setMonth(Number(md[1]) - 1, Number(md[2]));
  return formatDate(target);
}

function parseLocation(text) {
  const value = String(text || "");
  const explicit = value.match(/(?:在|地点|上课地点|去)([\u4e00-\u9fa5A-Za-z0-9]{1,16}?)(?:上课|训练|排|安排|约|预约|$|，|,|\s)/);
  if (explicit) return explicit[1].replace(/上$/, "");
  const tail = value.match(/(?:，|,|\s)([\u4e00-\u9fa5A-Za-z0-9]{1,12})(?:上课|训练)$/);
  if (tail) return tail[1];
  const clean = normalizeText(value);
  if (clean.length > 0 && clean.length <= 12 && !parseTime(clean) && !/今天|明天|后天|排|安排|预约|约|课表|哪些课|总结|训练|方案/.test(clean)) return clean;
  return "";
}

function hasScheduleIntent(text) {
  const normalized = normalizeText(text);
  const schedulingVerb = "(?:排|安排|约|预约|加|新增|创建|建|订|定)";
  const lessonObject = "(?:课|课程|训练)";
  return new RegExp(`${schedulingVerb}.{0,12}${lessonObject}`).test(normalized)
    || new RegExp(`${lessonObject}.{0,8}${schedulingVerb}`).test(normalized)
    || /(?:给|帮|为).{0,16}(?:一节课|节课|课程|训练)/.test(normalized);
}

function hasTodayQueryIntent(text) {
  const normalized = normalizeText(text);
  return /课表|今日课|今天.*(?:哪些课|几节课|有什么课|有课吗)|下一节/.test(normalized) && !hasScheduleIntent(normalized);
}

function hasStudentQueryIntent(text) {
  return /剩余|课时|最近课程|最近总结|学员/.test(text) && !hasScheduleIntent(text);
}

function hasTrainingPlanIntent(text) {
  return /训练方案|课前方案|做.*方案|生成.*方案/.test(text);
}

function hasLessonSummaryIntent(text) {
  return /记录训练|训练记录|课程总结|课后总结|刚才|表现|完成度|强度/.test(text);
}

function isSwitchToDifferentWriteTask(text, currentIntent) {
  if (currentIntent !== INTENTS.CREATE_LESSON && hasScheduleIntent(text)) return true;
  if (currentIntent !== INTENTS.GENERATE_TRAINING_PLAN && hasTrainingPlanIntent(text)) return true;
  if (currentIntent !== INTENTS.SAVE_LESSON_SUMMARY && hasLessonSummaryIntent(text)) return true;
  return false;
}

async function todayContext(openid, clientTime) {
  const now = clientTime ? new Date(clientTime) : new Date();
  const start = startOfDay(now);
  const end = endOfDay(now);
  const lessons = await db.collection("lessons").where({
    coach_openid: openid,
    status: _.neq("cancelled"),
    start_at: _.gte(start).and(_.lte(end))
  }).orderBy("start_at", "asc").limit(50).get();
  const pending = lessons.data.filter((item) => item.status === "completed" && item.summary_status !== "completed").length;
  const next = lessons.data.find((item) => item.status !== "completed" && new Date(item.start_at) >= now);
  return {
    todayLessonCount: lessons.data.length,
    nextLesson: next ? { time: next.start_time || formatTime(next.start_at), student_name: next.student_name } : null,
    pendingSummaryCount: pending
  };
}

function toClientCard(row) {
  return {
    confirmationId: row._id,
    status: row.status,
    cardType: row.card_type,
    title: row.title,
    summary: row.summary,
    display_fields: row.display_fields || [],
    editable_fields: row.editable_fields || [],
    payload: row.payload || {},
    warning: row.warning || "",
    expires_at: row.expires_at
  };
}

async function getPendingConfirmations(openid) {
  const now = new Date();
  const res = await db.collection("ai_confirmations").where({
    coach_openid: openid,
    status: "pending",
    expires_at: _.gt(now)
  }).orderBy("created_at", "desc").limit(10).get();
  return res.data.filter((row) => row.payload && row.payload.schema_version === 2).map(toClientCard);
}

async function saveMessage(openid, role, type, text, cardRef, sourceContext) {
  try {
    const created = await db.collection("ai_messages").add({
      data: {
        coach_openid: openid,
        role,
        type,
        text: text || "",
        card_ref: cardRef || "",
        source_context: sourceContext || null,
        created_at: db.serverDate()
      }
    });
    return created._id;
  } catch (error) {
    console.warn("saveMessage failed", error);
    return `local_${Date.now()}`;
  }
}

async function logCall(openid, data) {
  try {
    await db.collection("ai_call_logs").add({
      data: Object.assign({
        coach_openid: openid,
        created_at: db.serverDate()
      }, data)
    });
  } catch (error) {
    console.warn("ai_call_logs failed", error);
  }
}

async function getCoachSettings(openid) {
  const res = await safeGet(
    db.collection("coach_settings").where({ coach_openid: openid }).limit(1).get(),
    { data: [] },
    "coach_settings"
  );
  return res.data[0] || { default_lesson_duration: 60 };
}

async function getActiveTaskState(openid) {
  const now = new Date();
  const result = await safeGet(
    db.collection("ai_task_state").where({
      coach_openid: openid,
      status: "collecting",
      expires_at: _.gt(now)
    }).orderBy("updated_at", "desc").limit(5).get(),
    { data: [] },
    "ai_task_state"
  );
  const active = result.data[0] || null;
  for (let i = 1; i < result.data.length; i += 1) {
    await updateTaskState(result.data[i]._id, { status: "cancelled", blocked_reason: "superseded_by_newer_task" });
  }
  return active;
}

async function createTaskState(openid, intent, slots, missingSlots, sourceContext, lastQuestion) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const data = {
    schema_version: 1,
    coach_openid: openid,
    intent,
    status: "collecting",
    slots: slots || {},
    missing_slots: missingSlots || [],
    blocked_reason: "",
    last_question: lastQuestion || "",
    source_context: sourceContext || {},
    confirmation_id: "",
    expires_at: expiresAt,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const created = await db.collection("ai_task_state").add({ data });
  return Object.assign({ _id: created._id }, data);
}

async function updateTaskState(taskStateId, data) {
  if (!taskStateId) return;
  try {
    await db.collection("ai_task_state").doc(taskStateId).update({
      data: Object.assign({}, data, { updated_at: db.serverDate() })
    });
  } catch (error) {
    console.warn("updateTaskState failed", error);
  }
}

async function upsertCollectingTask(openid, taskState, intent, slots, missingSlots, sourceContext, lastQuestion) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  if (taskState && taskState._id) {
    await updateTaskState(taskState._id, {
      intent,
      status: "collecting",
      slots,
      missing_slots: missingSlots,
      last_question: lastQuestion || "",
      source_context: sourceContext || taskState.source_context || {},
      expires_at: expiresAt
    });
    return Object.assign({}, taskState, { intent, slots, missing_slots: missingSlots, source_context: sourceContext || taskState.source_context || {} });
  }
  return createTaskState(openid, intent, slots, missingSlots, sourceContext, lastQuestion);
}

function taskQuestion(intent, missingSlots) {
  const missing = missingSlots || [];
  if (intent === INTENTS.CREATE_LESSON) {
    if (missing.includes("student_name")) return "要给哪位学员排课？请补充学员姓名。";
    if (missing.includes("date_text") || missing.includes("start_time_text")) return "安排哪一天几点？例如：明天下午三点。";
    if (missing.includes("location")) return "本次上课地点是哪里？";
  }
  if (intent === INTENTS.GENERATE_TRAINING_PLAN) return "训练方案需要绑定到某一节课，请说明是哪一节课。";
  if (intent === INTENTS.SAVE_LESSON_SUMMARY) return "课程训练总结需要绑定到单节课程，请说明是哪一节课，或补充课后实际情况。";
  return "请补充必要信息。";
}

function sanitizeEntities(raw) {
  const input = raw || {};
  return {
    student_name: String(input.student_name || "").trim(),
    date_text: String(input.date_text || "").trim(),
    start_time_text: String(input.start_time_text || "").trim(),
    end_time_text: String(input.end_time_text || "").trim(),
    duration_minutes: Number(input.duration_minutes) || null,
    location: String(input.location || "").trim(),
    lesson_ref_text: String(input.lesson_ref_text || "").trim(),
    training_theme: String(input.training_theme || "").trim(),
    summary_text: String(input.summary_text || "").trim(),
    raw_actions: Array.isArray(input.raw_actions) ? input.raw_actions : []
  };
}

function validateExtraction(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(raw, "coach_openid")
    || Object.prototype.hasOwnProperty.call(raw, "_openid")
    || Object.prototype.hasOwnProperty.call(raw, "action_type")) {
    return null;
  }
  const intent = VALID_INTENTS.includes(raw.intent) ? raw.intent : INTENTS.OTHER;
  const missing = Array.isArray(raw.missing_slots)
    ? raw.missing_slots.filter((slot) => MISSING_SLOT_WHITELIST.includes(slot))
    : [];
  return {
    intent,
    confidence: Number(raw.confidence) || 0,
    entities: sanitizeEntities(raw.entities),
    task_control: ["none", "cancel_current", "switch_task"].includes(raw.task_control) ? raw.task_control : "none",
    missing_slots: missing,
    normalized_text: String(raw.normalized_text || ""),
    clarification_question: String(raw.clarification_question || "")
  };
}

function fallbackExtraction(text, previousTaskState) {
  const normalized = normalizeText(text);
  let intent = previousTaskState && WRITE_INTENTS.includes(previousTaskState.intent) ? previousTaskState.intent : INTENTS.OTHER;
  if (!previousTaskState) {
    if (hasScheduleIntent(text)) intent = INTENTS.CREATE_LESSON;
    else if (hasTrainingPlanIntent(text)) intent = INTENTS.GENERATE_TRAINING_PLAN;
    else if (hasLessonSummaryIntent(text)) intent = INTENTS.SAVE_LESSON_SUMMARY;
    else if (hasTodayQueryIntent(text)) intent = INTENTS.QUERY_TODAY_LESSONS;
    else if (hasStudentQueryIntent(text)) intent = INTENTS.QUERY_STUDENT;
  }
  const entities = sanitizeEntities({
    student_name: "",
    date_text: /今天|今日|明天|后天|\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2}/.test(text) ? text : "",
    start_time_text: parseTime(text) ? text : "",
    end_time_text: parseEndTime(text) ? text : "",
    location: parseLocation(text),
    lesson_ref_text: /这节课|刚才|上一节|下一节|\d{1,2}月\d{1,2}日|\d{1,2}[:：点]/.test(text) ? text : "",
    training_theme: hasTrainingPlanIntent(text) ? text.replace(/训练方案|课前方案|帮我|生成|做/g, "").trim() : "",
    summary_text: hasLessonSummaryIntent(text) && normalized.length > 8 ? text : "",
    raw_actions: extractActions(text)
  });
  return {
    intent,
    confidence: 0.5,
    entities,
    task_control: CANCEL_RE.test(normalized) ? "cancel_current" : "none",
    missing_slots: [],
    normalized_text: text,
    clarification_question: ""
  };
}

async function extractIntent(openid, text, previousTaskState, sourceContext, clientTime) {
  let modelResult = null;
  try {
    modelResult = await modelAdapter.generateIntentExtraction({
      text,
      previousTaskState,
      sourceContext,
      clientTime
    });
  } catch (error) {
    if (process.env.LLM_API_KEY && (process.env.LLM_BASE_URL || process.env.LLM_API_URL)) {
      await logCall(openid, {
        request_type: "intent",
        intent: "schema_invalid",
        provider: "openai_compatible",
        model: process.env.LLM_MODEL || "",
        input_length: text.length,
        success: false,
        error_message: error.message,
        usage: null
      });
      return {
        intent: INTENTS.OTHER,
        confidence: 0,
        entities: sanitizeEntities({}),
        task_control: "none",
        missing_slots: [],
        normalized_text: text,
        clarification_question: "AI 返回格式异常，请重新描述一次。"
      };
    }
    modelResult = { usedModel: false, provider: "local_fallback", model: "rules", usage: null, error: error.message };
  }
  const validated = validateExtraction(modelResult && modelResult.data);
  if (validated) {
    await logCall(openid, {
      request_type: "intent",
      intent: validated.intent,
      provider: modelResult.provider,
      model: modelResult.model,
      input_length: text.length,
      success: true,
      usage: modelResult.usage
    });
    return validated;
  }
  if (modelResult && modelResult.usedModel) {
    await logCall(openid, {
      request_type: "intent",
      intent: "schema_invalid",
      provider: modelResult.provider,
      model: modelResult.model,
      input_length: text.length,
      success: false,
      error_message: "intent extraction schema invalid",
      usage: modelResult.usage
    });
    return {
      intent: INTENTS.OTHER,
      confidence: 0,
      entities: sanitizeEntities({}),
      task_control: "none",
      missing_slots: [],
      normalized_text: text,
      clarification_question: "AI 返回格式异常，请重新描述一次。"
    };
  }
  return fallbackExtraction(text, previousTaskState);
}

async function answerToday(openid, clientTime) {
  const now = clientTime ? new Date(clientTime) : new Date();
  const start = startOfDay(now);
  const end = endOfDay(now);
  const lessons = await db.collection("lessons").where({
    coach_openid: openid,
    status: _.neq("cancelled"),
    start_at: _.gte(start).and(_.lte(end))
  }).orderBy("start_at", "asc").limit(50).get();
  if (!lessons.data.length) {
    return cardResponse("", {
      title: "今日课表",
      summary: "今天还没有课程",
      items: [{ label: "建议", value: "可以直接说“给小王明天下午三点排一节课”" }]
    });
  }
  return cardResponse("", {
    title: `今日 ${lessons.data.length} 节课`,
    summary: "按开始时间排序",
    items: lessons.data.map((item) => ({
      label: `${item.start_time}-${item.end_time}`,
      value: `${item.student_name} · ${item.summary_status === "completed" ? "总结已完成" : "总结未完成"}`
    }))
  }, {
    evidence: lessons.data.map((item) => ({ type: "lesson", id: item._id, label: `${item.start_time} ${item.student_name}` }))
  });
}

async function matchStudents(openid, text) {
  const normalized = normalizeText(text);
  const students = await db.collection("students").where({ coach_openid: openid, status: _.neq("deleted") }).limit(100).get();
  return students.data.filter((student) => {
    const name = normalizeText(student.name);
    return name && (normalized.includes(name) || normalized === name);
  });
}

async function answerStudent(openid, text) {
  const matched = await matchStudents(openid, text);
  if (matched.length === 0) return textResponse("followup", "你想查询哪位学员？请说出完整姓名。");
  if (matched.length > 1) return textResponse("followup", `找到了多个同名学员：${matched.map((item) => item.name).join("、")}。请选择具体学员。`);
  const student = matched[0];
  const summaries = await safeGet(
    db.collection("lesson_summaries").where({ coach_openid: openid, student_id: student._id }).orderBy("updated_at", "desc").limit(1).get(),
    { data: [] },
    "lesson_summaries"
  );
  const summary = summaries.data[0];
  return textResponse("answer", `${student.name} 当前剩余 ${student.remaining_lessons || 0} 节课。最近课程总结：${summary ? (summary.title || summary.theme || "已记录") : "暂无"}`, {
    evidence: [{ type: "student", id: student._id, label: `${student.name}，剩余 ${student.remaining_lessons || 0} 课时` }]
  });
}

async function findConflict(openid, startAt, endAt) {
  const result = await db.collection("lessons").where({
    coach_openid: openid,
    status: _.neq("cancelled"),
    start_at: _.lt(endAt),
    end_at: _.gt(startAt)
  }).limit(1).get();
  return result.data[0];
}

function mergeSlots(taskState, entities) {
  const slots = Object.assign({}, taskState && taskState.slots ? taskState.slots : {});
  const data = entities || {};
  Object.keys(data).forEach((key) => {
    if (key === "raw_actions" && Array.isArray(data.raw_actions) && data.raw_actions.length) slots.raw_actions = data.raw_actions;
    else if (data[key] !== "" && data[key] !== null && data[key] !== undefined && key !== "duration_minutes") slots[key] = data[key];
    else if (key === "duration_minutes" && data[key]) slots[key] = data[key];
  });
  return slots;
}

async function resolveStudent(openid, slots, text, sourceContext) {
  if (sourceContext && sourceContext.student_id) {
    const student = await safeGet(db.collection("students").doc(sourceContext.student_id).get(), null, "student");
    if (student && student.data && student.data.coach_openid === openid) return { student: student.data, studentId: sourceContext.student_id };
  }
  const matched = await matchStudents(openid, [slots.student_name, text].filter(Boolean).join(" "));
  if (matched.length === 1) return { student: matched[0], studentId: matched[0]._id };
  if (matched.length > 1) return { error: "duplicate" };
  return { error: "missing" };
}

async function resolveCreateLesson(openid, extraction, taskState, sourceContext, clientTime, text) {
  const slots = mergeSlots(taskState, extraction.entities);
  const studentResult = await resolveStudent(openid, slots, text, sourceContext);
  const missing = [];
  if (studentResult.error === "duplicate") return { status: "blocked", text: "找到了多个同名学员，请先在学员列表确认具体对象。", slots, missing_slots: ["student_name"] };
  if (studentResult.student) {
    slots.student_id = studentResult.studentId;
    slots.student_name = studentResult.student.name;
  } else {
    missing.push("student_name");
  }

  const dateText = [slots.date_text, text].filter(Boolean).join(" ");
  const parsedDate = slots.date || parseTargetDate(dateText, clientTime);
  if (parsedDate) slots.date = parsedDate;
  else missing.push("date_text");

  const startText = [slots.start_time_text, text].filter(Boolean).join(" ");
  const startTime = slots.start_time || parseTime(startText);
  if (startTime) slots.start_time = startTime;
  else missing.push("start_time_text");

  const settings = await getCoachSettings(openid);
  const defaultDuration = Number(settings.default_lesson_duration || 60);
  const endText = [slots.end_time_text, text].filter(Boolean).join(" ");
  const endTime = slots.end_time || parseEndTime(endText) || (startTime ? addMinutes(startTime, Number(slots.duration_minutes || defaultDuration)) : "");
  if (endTime) slots.end_time = endTime;

  if (!slots.location && studentResult.student && studentResult.student.default_location) slots.location = studentResult.student.default_location;
  if (!slots.location) slots.location = parseLocation([extraction.entities.location, text].filter(Boolean).join(" "));
  if (!slots.location) missing.push("location");

  if (missing.length) return { status: "missing", slots, missing_slots: missing };
  const startAt = parseDateTime(slots.date, slots.start_time);
  const endAt = parseDateTime(slots.date, slots.end_time);
  if (!startAt || !endAt || endAt <= startAt) return { status: "blocked", text: "课程时间无效，请重新说明开始和结束时间。", slots, missing_slots: ["start_time_text", "end_time_text"] };
  const units = durationToUnits((endAt.getTime() - startAt.getTime()) / 60000);
  slots.lesson_units = units;
  if (Number(studentResult.student.remaining_lessons || 0) < units) return { status: "blocked", text: `${studentResult.student.name} 剩余课时不足，不能直接排课。`, slots, missing_slots: [] };
  const conflict = await findConflict(openid, startAt, endAt);
  if (conflict) return { status: "blocked", text: "该时间段已有课程，不能生成排课确认卡。", slots, missing_slots: [] };
  return { status: "ready", slots, missing_slots: [], student: studentResult.student };
}

async function resolveLessonById(openid, lessonId) {
  if (!lessonId) return null;
  const lesson = await safeGet(db.collection("lessons").doc(lessonId).get(), null, "lesson");
  if (lesson && lesson.data && lesson.data.coach_openid === openid && lesson.data.status !== "cancelled") {
    return Object.assign({ _id: lessonId }, lesson.data);
  }
  return null;
}

async function findCandidateLessons(openid, text, clientTime, preferCompleted) {
  const matchedStudents = await matchStudents(openid, text);
  const date = parseTargetDate(text, clientTime);
  const where = { coach_openid: openid, status: preferCompleted ? "completed" : _.neq("cancelled") };
  if (matchedStudents.length === 1) where.student_id = matchedStudents[0]._id;
  if (date) where.date = date;
  const result = await db.collection("lessons").where(where).orderBy("start_at", preferCompleted ? "desc" : "asc").limit(20).get();
  const lessons = result.data;
  if (parseTime(text)) {
    const target = timeToMinutes(parseTime(text));
    return lessons.filter((lesson) => Math.abs(timeToMinutes(lesson.start_time) - target) <= 90);
  }
  return lessons;
}

async function resolveTrainingPlan(openid, extraction, taskState, sourceContext, clientTime, text) {
  const slots = mergeSlots(taskState, extraction.entities);
  const fromContext = await resolveLessonById(openid, sourceContext && sourceContext.lesson_id);
  let lesson = fromContext || await resolveLessonById(openid, slots.lesson_id);
  if (!lesson) {
    const candidates = await findCandidateLessons(openid, [slots.lesson_ref_text, text].filter(Boolean).join(" "), clientTime, false);
    if (candidates.length === 1) lesson = candidates[0];
    else if (candidates.length > 1) return { status: "blocked", text: `找到了多节候选课程：${candidates.map((item) => `${item.date} ${item.start_time} ${item.student_name}`).join("；")}。请说明具体哪一节课。`, slots, missing_slots: ["lesson_id"] };
  }
  if (!lesson) return { status: "missing", slots, missing_slots: ["lesson_id"] };
  slots.lesson_id = lesson._id;
  slots.training_theme = slots.training_theme || text.replace(/训练方案|课前方案|帮我|生成|做/g, "").trim() || "单节课训练方案";
  return { status: "ready", slots, missing_slots: [], lesson };
}

async function resolveLessonSummary(openid, extraction, taskState, sourceContext, clientTime, text) {
  const slots = mergeSlots(taskState, extraction.entities);
  const fromContext = await resolveLessonById(openid, sourceContext && sourceContext.lesson_id);
  let lesson = fromContext || await resolveLessonById(openid, slots.lesson_id);
  if (!lesson) {
    const candidates = await findCandidateLessons(openid, [slots.lesson_ref_text, text].filter(Boolean).join(" "), clientTime, true);
    if (candidates.length === 1) lesson = candidates[0];
    else if (candidates.length > 1) return { status: "blocked", text: `找到了多节候选课程：${candidates.map((item) => `${item.date} ${item.start_time} ${item.student_name}`).join("；")}。请说明具体哪一节课。`, slots, missing_slots: ["lesson_id"] };
  }
  if (!lesson) {
    const latest = await db.collection("lessons").where({
      coach_openid: openid,
      status: "completed",
      summary_status: _.neq("completed")
    }).orderBy("start_at", "desc").limit(1).get();
    lesson = latest.data[0] || null;
  }
  if (!lesson) return { status: "missing", slots, missing_slots: ["lesson_id"] };
  slots.lesson_id = lesson._id;
  slots.summary_text = slots.summary_text || (hasLessonSummaryIntent(text) && normalizeText(text).length > 8 ? text : "");
  if (!slots.summary_text) return { status: "missing", slots, missing_slots: ["summary_text"] };
  slots.raw_actions = slots.raw_actions && slots.raw_actions.length ? slots.raw_actions : extractActions(slots.summary_text);
  return { status: "ready", slots, missing_slots: [], lesson };
}

async function createConfirmation(openid, taskStateId, actionType, cardType, title, summary, fields, payload, sourceInput, warning, editableFields) {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const serverPayload = Object.assign({
    schema_version: 2,
    task_state_id: taskStateId || "",
    source: "ai"
  }, payload);
  const result = await db.collection("ai_confirmations").add({
    data: {
      coach_openid: openid,
      status: "pending",
      action_type: actionType,
      card_type: cardType,
      title,
      summary,
      display_fields: fields,
      editable_fields: editableFields || [],
      payload: serverPayload,
      task_state_id: taskStateId || "",
      evidence: [],
      source_input: sourceInput,
      source_transcript: sourceInput,
      warning: warning || "",
      expires_at: expiresAt,
      executed_at: null,
      error_message: "",
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });
  const row = {
    _id: result._id,
    status: "pending",
    card_type: cardType,
    title,
    summary,
    display_fields: fields,
    editable_fields: editableFields || [],
    payload: serverPayload,
    warning,
    expires_at: expiresAt
  };
  await updateTaskState(taskStateId, {
    status: "confirmation_created",
    confirmation_id: result._id,
    expires_at: expiresAt
  });
  return toClientCard(row);
}

async function createReadyTask(openid, taskState, intent, slots, sourceContext) {
  const missingSlots = [];
  const existing = await upsertCollectingTask(openid, taskState, intent, slots, missingSlots, sourceContext, "");
  return existing._id;
}

async function createScheduleConfirmation(openid, taskStateId, resolved, text) {
  const slots = resolved.slots;
  const student = resolved.student;
  const fields = [
    { label: "学员", value: student.name },
    { label: "日期", value: slots.date },
    { label: "时间", value: `${slots.start_time}-${slots.end_time}` },
    { label: "地点", value: slots.location },
    { label: "消耗课时", value: `${slots.lesson_units}` },
    { label: "当前剩余", value: `${student.remaining_lessons || 0}` }
  ];
  const card = await createConfirmation(openid, taskStateId, "create_lesson", "schedule_confirm_card", "排课确认", `将为 ${student.name} 创建 ${dateLabel(new Date(`${slots.date}T00:00:00`))} ${slots.start_time} 的课程。`, fields, {
    student_id: slots.student_id,
    date: slots.date,
    start_time: slots.start_time,
    end_time: slots.end_time,
    location: slots.location,
    lesson_units: slots.lesson_units
  }, text, "", ["date", "start_time", "end_time", "location"]);
  return textResponse("confirm_card", "请确认排课信息，确认后才会写入日程。", { card });
}

async function createTrainingPlanConfirmation(openid, taskStateId, resolved, text) {
  const lesson = resolved.lesson;
  const slots = resolved.slots;
  const fields = [
    { label: "学员", value: lesson.student_name },
    { label: "课程", value: `${lesson.date} ${lesson.start_time}` },
    { label: "训练主题", value: slots.training_theme },
    { label: "注意事项", value: "结合学员备注与当次目标，保存前可手动调整。" }
  ];
  const card = await createConfirmation(openid, taskStateId, "save_training_plan", "training_plan_confirm_card", "训练方案确认", "确认后将保存到该课程的课前训练方案。", fields, {
    lesson_id: lesson._id,
    theme: slots.training_theme,
    warmup: "动态热身 8-10 分钟",
    main_actions: [],
    notes: text
  }, text, lesson.training_plan ? "该课程已有方案，确认后将更新。" : "", []);
  return textResponse("confirm_card", "请确认课前训练方案。", { card });
}

async function createSummaryConfirmation(openid, taskStateId, resolved, text) {
  const lesson = resolved.lesson;
  const slots = resolved.slots;
  const fields = [
    { label: "学员", value: lesson.student_name },
    { label: "课程", value: `${lesson.date} ${lesson.start_time}` },
    { label: "课程总结", value: slots.summary_text },
    { label: "动作归一", value: "未明确动作将以原始名称暂存" }
  ];
  const card = await createConfirmation(openid, taskStateId, "save_lesson_summary", "lesson_summary_confirm_card", "课程训练总结确认", "确认后将保存或更新该课程训练总结。", fields, {
    lesson_id: lesson._id,
    student_id: lesson.student_id,
    title: `${lesson.date} ${lesson.student_name}课程总结`,
    theme: lesson.training_plan && lesson.training_plan.theme ? lesson.training_plan.theme : "未填写",
    summary_text: slots.summary_text,
    actions: slots.raw_actions || []
  }, text, "请检查动作名称归一结果；不确定项会保留原始名称。", []);
  return textResponse("confirm_card", "请确认课程训练总结。", { card });
}

function extractActions(text) {
  const names = ["卧推", "面拉", "深蹲", "硬拉", "飞鸟", "直臂下压", "平板支撑"];
  return names.filter((name) => text.includes(name)).map((name) => ({
    raw_name: name,
    canonical_name: name === "卧推" ? "杠铃卧推" : name,
    normalization_status: name === "卧推" ? "matched_alias" : "unnormalized",
    status: "completed",
    notes: ""
  }));
}

async function planWriteTask(openid, taskState, extraction, sourceContext, clientTime, text) {
  let resolved;
  if (extraction.intent === INTENTS.CREATE_LESSON) {
    resolved = await resolveCreateLesson(openid, extraction, taskState, sourceContext, clientTime, text);
  } else if (extraction.intent === INTENTS.GENERATE_TRAINING_PLAN) {
    resolved = await resolveTrainingPlan(openid, extraction, taskState, sourceContext, clientTime, text);
  } else if (extraction.intent === INTENTS.SAVE_LESSON_SUMMARY) {
    resolved = await resolveLessonSummary(openid, extraction, taskState, sourceContext, clientTime, text);
  }

  if (!resolved) return textResponse("answer", "我可以帮你查课表、查学员、排课、整理课前训练方案和课程训练总结。");
  if (resolved.status === "blocked") {
    await upsertCollectingTask(openid, taskState, extraction.intent, resolved.slots, resolved.missing_slots || [], sourceContext, resolved.text);
    return textResponse("followup", resolved.text);
  }
  if (resolved.status === "missing") {
    const question = taskQuestion(extraction.intent, resolved.missing_slots);
    await upsertCollectingTask(openid, taskState, extraction.intent, resolved.slots, resolved.missing_slots, sourceContext, question);
    return textResponse("followup", question);
  }

  const taskStateId = await createReadyTask(openid, taskState, extraction.intent, resolved.slots, sourceContext);
  if (extraction.intent === INTENTS.CREATE_LESSON) return createScheduleConfirmation(openid, taskStateId, resolved, text);
  if (extraction.intent === INTENTS.GENERATE_TRAINING_PLAN) return createTrainingPlanConfirmation(openid, taskStateId, resolved, text);
  return createSummaryConfirmation(openid, taskStateId, resolved, text);
}

async function route(openid, event) {
  const text = (event.text || "").trim();
  const sourceContext = event.sourceContext || {};
  if (!text) return textResponse("followup", "请告诉我你想做什么。");
  if (FORBIDDEN_RE.test(text)) return textResponse("refusal", "这个操作涉及课时资产、删除、通知或系统配置，第一版不能由 AI 执行。请到对应手动页面处理。");

  const activeTask = await getActiveTaskState(openid);
  const clean = normalizeText(text);
  if (activeTask && CANCEL_RE.test(clean)) {
    await updateTaskState(activeTask._id, { status: "cancelled", blocked_reason: "user_cancelled" });
    return textResponse("answer", "已取消当前任务，未写入数据。");
  }
  if (activeTask && hasTodayQueryIntent(text)) return answerToday(openid, event.clientTime);
  if (activeTask && isSwitchToDifferentWriteTask(text, activeTask.intent)) {
    return textResponse("followup", "当前还有一个未完成任务。请先说“取消任务”放弃当前任务，再开始新的写入任务。");
  }

  const extraction = await extractIntent(openid, text, activeTask, sourceContext, event.clientTime);
  if (extraction.task_control === "cancel_current" && activeTask) {
    await updateTaskState(activeTask._id, { status: "cancelled", blocked_reason: "user_cancelled" });
    return textResponse("answer", "已取消当前任务，未写入数据。");
  }

  if (extraction.intent === INTENTS.QUERY_TODAY_LESSONS) return answerToday(openid, event.clientTime);
  if (extraction.intent === INTENTS.QUERY_STUDENT) return answerStudent(openid, extraction.normalized_text || text);
  if (WRITE_INTENTS.includes(extraction.intent)) {
    return planWriteTask(openid, activeTask && activeTask.intent === extraction.intent ? activeTask : null, extraction, sourceContext, event.clientTime, extraction.normalized_text || text);
  }
  if (extraction.clarification_question) return textResponse("followup", extraction.clarification_question);

  const directStudent = await resolveStudent(openid, {}, text, sourceContext);
  if (directStudent.student) return textResponse("followup", `要给 ${directStudent.student.name} 安排哪一天几点？例如：明天下午三点。`);
  return textResponse("answer", "我可以帮你查课表、查学员、排课、整理课前训练方案和课程训练总结。");
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail("NO_OPENID", "无法获取用户身份");
  if (!(await ensureCoach(OPENID))) return fail("NOT_COACH", "当前用户不是教练");

  if (event.action === "getTodayContext") {
    return { success: true, data: await todayContext(OPENID, event.clientTime) };
  }
  if (event.action === "getPendingConfirmations") {
    return { success: true, data: await getPendingConfirmations(OPENID) };
  }

  await saveMessage(OPENID, "user", "text", event.text || "", "", event.sourceContext);
  const response = await route(OPENID, event);
  const messageId = await saveMessage(OPENID, "assistant", response.type, response.text, response.card && response.card.confirmationId, event.sourceContext);
  response.messageId = messageId;
  return response;
};
