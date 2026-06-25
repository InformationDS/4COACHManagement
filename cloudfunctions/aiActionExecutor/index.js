const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const VALID_UNITS = [0.5, 1, 1.5, 2];

function fail(error_code, error_message, extra) {
  return Object.assign({ success: false, type: "error", error_code, error_message, text: error_message }, extra || {});
}

async function ensureCoach(openid) {
  const res = await db.collection("users").where({ openid, role: "coach" }).limit(1).get();
  return !!res.data.length;
}

function parseDateTime(dateText, timeText) {
  const parts = String(dateText || "").split("-").map(Number);
  const time = String(timeText || "").split(":").map(Number);
  if (parts.length !== 3 || time.length < 2) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], time[0], time[1], 0, 0);
}

function durationToUnits(startAt, endAt) {
  const minutes = (endAt.getTime() - startAt.getTime()) / 60000;
  if (minutes <= 30) return 0.5;
  if (minutes <= 60) return 1;
  if (minutes <= 90) return 1.5;
  return 2;
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

function mergeEditable(payload, userEdits, editableFields) {
  const next = Object.assign({}, payload);
  const allowed = editableFields || [];
  const ignored = [];
  Object.keys(userEdits || {}).forEach((key) => {
    if (allowed.includes(key)) next[key] = userEdits[key];
    else ignored.push(key);
  });
  return { payload: next, ignoredFields: ignored };
}

async function updateTaskState(taskStateId, status, blockedReason) {
  if (!taskStateId) return;
  try {
    await db.collection("ai_task_state").doc(taskStateId).update({
      data: {
        status,
        blocked_reason: blockedReason || "",
        updated_at: db.serverDate()
      }
    });
  } catch (error) {
    console.warn("update ai_task_state failed", error);
  }
}

async function executeCreateLesson(openid, payload) {
  const student = await db.collection("students").doc(payload.student_id).get();
  if (!student.data || student.data.coach_openid !== openid) return fail("STUDENT_NOT_FOUND", "学员不存在");

  const startAt = parseDateTime(payload.date, payload.start_time);
  const endAt = parseDateTime(payload.date, payload.end_time);
  if (!startAt || !endAt || endAt <= startAt) return fail("VALIDATION_FAILED", "课程时间无效");

  const units = durationToUnits(startAt, endAt);
  if (!VALID_UNITS.includes(units)) return fail("VALIDATION_FAILED", "消耗课时无效");
  if (Number(student.data.remaining_lessons || 0) < units) return fail("INSUFFICIENT_BALANCE", "课时不足");
  if (!payload.location) return fail("VALIDATION_FAILED", "上课地点不能为空");

  const conflict = await findConflict(openid, startAt, endAt);
  if (conflict) return fail("TIME_CONFLICT", "该时间段已有课程");

  const data = {
    coach_openid: openid,
    student_id: payload.student_id,
    student_name: student.data.name,
    date: payload.date,
    start_time: payload.start_time,
    end_time: payload.end_time,
    start_at: startAt,
    end_at: endAt,
    location: payload.location,
    lesson_units: units,
    notes: payload.notes || "",
    status: "confirmed",
    summary_status: "none",
    training_plan: payload.training_plan || null,
    source: "ai",
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const created = await db.collection("lessons").add({ data });
  return {
    success: true,
    target_type: "lesson",
    target_id: created._id,
    card: {
      resultType: "schedule_created",
      summary: `已为 ${student.data.name} 创建课程`,
      route: { page: "lesson-detail", params: { lesson_id: created._id } }
    }
  };
}

async function executeSaveTrainingPlan(openid, payload) {
  const lesson = await db.collection("lessons").doc(payload.lesson_id).get();
  if (!lesson.data || lesson.data.coach_openid !== openid) return fail("LESSON_NOT_FOUND", "课程不存在");
  if (lesson.data.status === "cancelled") return fail("LESSON_CANCELLED", "已取消课程不能保存方案");
  await db.collection("lessons").doc(payload.lesson_id).update({
    data: {
      training_plan: {
        theme: payload.theme || "单节课训练方案",
        warmup: payload.warmup || "",
        main_actions: payload.main_actions || [],
        notes: payload.notes || ""
      },
      updated_at: db.serverDate()
    }
  });
  return {
    success: true,
    target_type: "lesson",
    target_id: payload.lesson_id,
    card: {
      resultType: "plan_saved",
      summary: "训练方案已保存",
      route: { page: "lesson-detail", params: { lesson_id: payload.lesson_id } }
    }
  };
}

async function executeSaveLessonSummary(openid, payload) {
  const lesson = await db.collection("lessons").doc(payload.lesson_id).get();
  if (!lesson.data || lesson.data.coach_openid !== openid) return fail("LESSON_NOT_FOUND", "课程不存在");
  if (lesson.data.status === "cancelled") return fail("LESSON_CANCELLED", "已取消课程不能保存总结");
  const existing = await db.collection("lesson_summaries").where({ coach_openid: openid, lesson_id: payload.lesson_id }).limit(1).get();
  const data = {
    coach_openid: openid,
    lesson_id: payload.lesson_id,
    student_id: lesson.data.student_id,
    title: payload.title || `${lesson.data.date} ${lesson.data.student_name}课程总结`,
    theme: payload.theme || "未填写",
    summary_text: payload.summary_text || "",
    actions: payload.actions || [],
    planned_actions: lesson.data.training_plan && lesson.data.training_plan.main_actions ? lesson.data.training_plan.main_actions : [],
    updated_at: db.serverDate()
  };
  let summaryId = "";
  if (existing.data.length) {
    summaryId = existing.data[0]._id;
    await db.collection("lesson_summaries").doc(summaryId).update({ data });
  } else {
    data.created_at = db.serverDate();
    const created = await db.collection("lesson_summaries").add({ data });
    summaryId = created._id;
  }
  await db.collection("lessons").doc(payload.lesson_id).update({
    data: { summary_status: "completed", updated_at: db.serverDate() }
  });
  return {
    success: true,
    target_type: "lesson_summary",
    target_id: summaryId,
    card: {
      resultType: "summary_saved",
      summary: "课程训练总结已保存",
      route: { page: "lesson-detail", params: { lesson_id: payload.lesson_id } }
    }
  };
}

async function logAction(openid, confirmationId, actionType, result, extra) {
  try {
    await db.collection("ai_action_logs").add({
      data: Object.assign({
        coach_openid: openid,
        confirmation_id: confirmationId,
        action_type: actionType,
        task_state_id: extra && extra.task_state_id ? extra.task_state_id : "",
        ignored_fields: extra && extra.ignored_fields ? extra.ignored_fields : [],
        target_type: result.target_type || "",
        target_id: result.target_id || "",
        success: !!result.success,
        error_code: result.error_code || "",
        error_message: result.error_message || "",
        created_at: db.serverDate()
      }, extra && extra.log_extra ? extra.log_extra : {})
    });
  } catch (error) {
    console.warn("ai_action_logs failed", error);
  }
}

async function loadConfirmation(openid, confirmationId) {
  if (!confirmationId) return { error: fail("VALIDATION_FAILED", "缺少确认卡 ID") };
  const confirmation = await db.collection("ai_confirmations").doc(confirmationId).get();
  const row = confirmation.data;
  if (!row || row.coach_openid !== openid) return { error: fail("NOT_OWNER", "无权执行该确认卡") };
  return { row };
}

async function cancelConfirmation(openid, confirmationId) {
  const loaded = await loadConfirmation(openid, confirmationId);
  if (loaded.error) return loaded.error;
  const row = loaded.row;
  if (row.status !== "pending") return fail("CONFIRMATION_USED", "确认卡已处理");
  await db.collection("ai_confirmations").doc(confirmationId).update({
    data: {
      status: "cancelled",
      updated_at: db.serverDate()
    }
  });
  const taskStateId = row.task_state_id || (row.payload && row.payload.task_state_id) || "";
  await updateTaskState(taskStateId, "cancelled", "user_cancelled_confirmation");
  const result = { success: true, target_type: "confirmation", target_id: confirmationId };
  await logAction(openid, confirmationId, row.action_type || "cancel", result, { task_state_id: taskStateId });
  return { success: true, type: "answer", text: "已取消，未写入数据。", card: null };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail("NO_OPENID", "无法获取用户身份");
  if (!(await ensureCoach(OPENID))) return fail("NOT_COACH", "当前用户不是教练");

  const confirmationId = event.confirmationId;
  if (event.action === "cancel") return cancelConfirmation(OPENID, confirmationId);

  const loaded = await loadConfirmation(OPENID, confirmationId);
  if (loaded.error) return loaded.error;
  const row = loaded.row;
  const taskStateId = row.task_state_id || (row.payload && row.payload.task_state_id) || "";

  if (row.status !== "pending") return fail("CONFIRMATION_USED", "确认卡已处理");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.collection("ai_confirmations").doc(confirmationId).update({ data: { status: "expired", updated_at: db.serverDate() } });
    await updateTaskState(taskStateId, "expired", "confirmation_expired");
    const result = fail("CONFIRMATION_EXPIRED", "确认卡已过期，请重新发起");
    await logAction(OPENID, confirmationId, row.action_type, result, { task_state_id: taskStateId });
    return result;
  }
  if (!row.payload || row.payload.schema_version !== 2) {
    await db.collection("ai_confirmations").doc(confirmationId).update({ data: { status: "expired", error_message: "schema outdated", updated_at: db.serverDate() } });
    await updateTaskState(taskStateId, "expired", "confirmation_schema_outdated");
    const result = fail("CONFIRMATION_SCHEMA_OUTDATED", "确认卡版本已过期，请重新发起");
    await logAction(OPENID, confirmationId, row.action_type, result, { task_state_id: taskStateId });
    return result;
  }

  const merged = mergeEditable(row.payload || {}, event.userEdits || {}, row.editable_fields || []);
  const payload = merged.payload;
  let result;
  if (row.action_type === "create_lesson") {
    result = await executeCreateLesson(OPENID, payload);
  } else if (row.action_type === "save_training_plan") {
    result = await executeSaveTrainingPlan(OPENID, payload);
  } else if (row.action_type === "save_lesson_summary") {
    result = await executeSaveLessonSummary(OPENID, payload);
  } else {
    result = fail("VALIDATION_FAILED", "确认卡动作不在白名单内");
  }

  await db.collection("ai_confirmations").doc(confirmationId).update({
    data: {
      status: result.success ? "confirmed" : "failed",
      executed_at: result.success ? db.serverDate() : null,
      error_message: result.error_message || "",
      updated_at: db.serverDate()
    }
  });
  await updateTaskState(taskStateId, result.success ? "completed" : "failed", result.error_code || "");
  await logAction(OPENID, confirmationId, row.action_type, result, {
    task_state_id: taskStateId,
    ignored_fields: merged.ignoredFields
  });

  if (!result.success) return result;
  return {
    success: true,
    type: "result_card",
    card: result.card,
    error_code: "",
    error_message: ""
  };
};
