const cloud = require('wx-server-sdk');
const modelAdapter = require('./lib/modelAdapter');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const RESPONSE_TYPES = {
  ANSWER: 'answer',
  FOLLOWUP: 'followup',
  CONFIRM_CARD: 'confirm_card',
  CHOICE_CARD: 'choice_card',
  RESULT_CARD: 'result_card',
  REFUSAL: 'refusal',
  ERROR: 'error'
};

const CONFIRM_TTL_MS = 15 * 60 * 1000;

exports.main = async (event = {}) => {
  const startedAt = Date.now();
  const wxContext = cloud.getWXContext();
  const coachOpenid = wxContext.OPENID;
  const action = event.action || 'message';
  const rawText = normalizeText(event.text);
  const sourceContext = event.sourceContext || {};
  const previousInput = normalizeText(sourceContext.previous_input);
  const text = previousInput ? `${previousInput} ${rawText}` : rawText;

  try {
    if (action === 'status') {
      return getStatusResponse();
    }

    const auth = await requireCoach(coachOpenid);
    if (!auth.ok) {
      return errorResponse('当前版本仅支持已注册教练使用 AI 助手。');
    }

    if (!rawText) {
      return followupResponse('请告诉我你想查询、排课或记录什么。');
    }

    const clientDate = getClientDate(event.clientTime);
    const safety = detectSafety(text);
    let result;

    if (safety.level === 'forbidden') {
      result = refusalResponse(safety.message);
    } else if (safety.level === 'out_of_scope') {
      result = refusalResponse('我只能处理私教工作台相关任务，比如查日程、查学员、记录训练、排课和运营复盘。');
    } else if (safety.level === 'health_risk') {
      result = answerResponse('这类内容可能涉及健康风险。我可以帮你记录现象或提醒训练注意事项，但不能做医疗诊断。若出现疼痛、麻木、急性损伤或持续不适，建议先停止相关动作并寻求专业医疗意见。');
    } else {
      const route = await classifyIntentWithModel(text, sourceContext, clientDate);
      const intent = route.intent;
      result = await handleIntent({
        intent,
        text,
        coachOpenid,
        clientDate,
        sourceContext: route.sourceContext,
        event,
        route
      });
      result.route_model = route.model || getModelMode();
      result.usage = result.usage || route.usage || {};
    }

    const silent = !!sourceContext.silent;
    if (!silent) {
      await persistConversation(coachOpenid, text, result, sourceContext);
    }
    await logCall({
      coachOpenid,
      requestType: silent && result.intent === 'query_today_lessons' ? 'today_summary_auto' : 'message',
      inputLength: text.length,
      intent: result.intent || '',
      model: result.route_model || getModelMode(),
      success: result.success !== false,
      errorMessage: result.error || '',
      usage: result.usage || {},
      latencyMs: Date.now() - startedAt
    });

    return result;
  } catch (err) {
    console.error('aiCoachAssistant error:', err);
    await logCall({
      coachOpenid,
      requestType: 'message',
      inputLength: text.length,
      intent: '',
      model: getModelMode(),
      success: false,
      errorMessage: err.message || 'unknown',
      usage: {},
      latencyMs: Date.now() - startedAt
    });
    return errorResponse('AI 助手暂时不可用，传统日程、学员和训练记录页面仍可正常使用。', err.message);
  }
};

function getStatusResponse() {
  const modelConfigured = modelAdapter.isConfigured();
  return {
    success: true,
    aiAvailable: modelConfigured,
    modelConfigured,
    voiceAvailable: false,
    modelMode: getModelMode(),
    degradedReason: modelConfigured ? '' : 'LLM_API_KEY is not configured; using rule-based fallback',
    message: modelConfigured
      ? 'AI 文本能力已配置，语音转写暂未接入。'
      : '模型未配置，当前使用规则降级能力；语音转写暂未接入。'
  };
}

function getModelMode() {
  return modelAdapter.isConfigured() ? 'cloud-function-openai-compatible' : 'rule-based-fallback';
}

async function requireCoach(openid) {
  if (!openid) return { ok: false };
  const res = await db.collection('users')
    .where({ _openid: openid, role: 'coach' })
    .limit(1)
    .get();
  return { ok: res.data && res.data.length > 0 };
}

function normalizeText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function getClientDate(clientTime) {
  if (clientTime && clientTime.date) return clientTime.date;
  const now = new Date();
  return formatDate(now);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function getWeekRange(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  const day = date.getDay() || 7;
  const start = new Date(date);
  start.setDate(date.getDate() - day + 1);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function getMonthRange(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function detectSafety(text) {
  if (/(充值|充课|加课时|增加课时|扣课时|扣减课时|批量调整|删除学员|删除课程|删除记录|清空|导出全部|全量导出|发通知|发微信|自动通知|修改AI配置|修改数据库权限)/.test(text)) {
    return {
      level: 'forbidden',
      message: '这个操作涉及课时资产、删除、外部通知或系统配置，AI 不会生成确认卡，也不会执行。请到对应传统页面手动处理。'
    };
  }
  if (/(自动完成|帮我完成课程|标记完成并扣|完课扣)/.test(text)) {
    return {
      level: 'forbidden',
      message: '完课和扣课时必须继续走日程页的受控流程，AI 不开放自动完课或扣课时入口。'
    };
  }
  if (/(诊断|拉伤|骨折|麻木|刺痛|胸痛|头晕|严重疼痛|受伤)/.test(text)) {
    return { level: 'health_risk' };
  }
  if (/(写.*诗|讲.*笑话|天气|股票|电影|旅行攻略|翻译一下)/.test(text) && !/(课程|学员|训练|健身|私教)/.test(text)) {
    return { level: 'out_of_scope' };
  }
  return { level: 'normal' };
}

function classifyIntent(text, sourceContext) {
  if (sourceContext && sourceContext.intent) return sourceContext.intent;
  if (/(取消.*课|取消课程)/.test(text)) return 'cancel_lesson';
  if (/(改.*课|修改.*课|调整.*课|换.*时间|换.*地点|改到|调整到)/.test(text)) return 'update_lesson';
  if (/(备注|更新.*备注|记一下)/.test(text)) return 'update_student_note';
  if (/(排.*课|安排.*课|约.*课|上一节课|加一节课|明天.*课|后天.*课)/.test(text)) return 'create_lesson';
  if (/(记录.*训练|补.*训练记录|训练记录|记录.*练|练胸|练背|练腿|练肩|训练内容|高位下拉|卧推|深蹲|硬拉)/.test(text)) return 'create_training_record';
  if (/(未写|没写|补训练记录|缺训练记录)/.test(text)) return 'missing_training_records';
  if (/(低课时|快没课|剩余.*课|课时偏低)/.test(text)) return 'low_balance_students';
  if (/(本周|这周|本月|这个月|运营|复盘|总结.*工作)/.test(text)) return 'operation_review';
  if (/(最近.*练|练得怎么样|训练情况|下次课建议)/.test(text)) return 'analyze_student';
  if (/(今天|今日|下一节|日程|还有几节课)/.test(text)) return 'query_today_lessons';
  if (/(学员|剩多少课|剩余课时)/.test(text)) return 'query_student';
  return 'unknown';
}

async function classifyIntentWithModel(text, sourceContext, clientDate) {
  const fallbackIntent = classifyIntent(text, sourceContext);
  if (!modelAdapter.isConfigured()) {
    return {
      intent: fallbackIntent,
      sourceContext,
      model: 'rule-based-intent',
      confidence: 0
    };
  }
  try {
    const res = await modelAdapter.classifyCoachIntent({ text, sourceContext, clientDate });
    if (res.ok && res.data && res.data.confidence >= 0.55 && res.data.intent !== 'unknown') {
      return {
        intent: res.data.intent,
        sourceContext: {
          ...(sourceContext || {}),
          ai_slots: res.data.slots || {},
          ai_route: {
            intent: res.data.intent,
            confidence: res.data.confidence,
            missing_slots: res.data.missing_slots || [],
            reason: res.data.reason || ''
          }
        },
        model: res.model || getModelMode(),
        confidence: res.data.confidence,
        usage: res.usage || {}
      };
    }
  } catch (err) {
    console.warn('intent model fallback:', err.message);
  }
  return {
    intent: fallbackIntent,
    sourceContext,
    model: 'rule-based-intent-fallback',
    confidence: 0
  };
}

async function handleIntent(ctx) {
  const { intent } = ctx;
  if (intent === 'today_summary' || intent === 'query_today_lessons') return getTodayAnswer(ctx);
  if (intent === 'missing_training_records') return getMissingTrainingAnswer(ctx);
  if (intent === 'low_balance_students') return getLowBalanceAnswer(ctx);
  if (intent === 'operation_review' || intent === 'query_stats') return getOperationReview(ctx);
  if (intent === 'query_student') return getStudentAnswer(ctx);
  if (intent === 'analyze_student') return getStudentAnalysis(ctx);
  if (intent === 'create_lesson') return prepareCreateLesson(ctx);
  if (intent === 'update_lesson') return prepareUpdateLesson(ctx);
  if (intent === 'create_training_record') return prepareTrainingRecord(ctx);
  if (intent === 'cancel_lesson') return prepareCancelLesson(ctx);
  if (intent === 'update_student_note') return prepareStudentNoteUpdate(ctx);
  return followupResponse('我还没理解你要处理什么。你可以说“查看今天日程”、“给张三明天下午3点排一节课”，或“记录张三今天练背，高位下拉4组12次”。', { intent: 'unknown' });
}

async function getTodayAnswer({ coachOpenid, clientDate }) {
  const [lessons, missingRecords, lowBalance] = await Promise.all([
    getLessonsByRange(coachOpenid, clientDate, clientDate),
    getMissingTrainingRecords(coachOpenid, addDays(clientDate, -7), clientDate),
    getLowBalanceStudents(coachOpenid, 2)
  ]);
  const sorted = lessons.slice().sort(sortLessonTime);
  const active = sorted.filter(l => l.status === 'pending' || l.status === 'confirmed');
  const completed = sorted.filter(l => l.status === 'completed');
  const next = active[0];
  const textLines = [
    `今天共有 ${sorted.length} 节课，待上 ${active.length} 节，已完成 ${completed.length} 节。`
  ];
  if (next) {
    textLines.push(`下一节：${next.start_time || ''} ${next.student_name || '学员'}，地点 ${next.location || '未指定'}。`);
  } else {
    textLines.push('今天暂时没有待上课程。');
  }
  if (missingRecords.length) textLines.push(`最近 7 天有 ${missingRecords.length} 节已完成课程未写训练记录。`);
  if (lowBalance.length) textLines.push(`${lowBalance.length} 名学员课时偏低，建议上课前确认续课。`);

  return answerResponse(textLines.join('\n'), {
    intent: 'query_today_lessons',
    summary: buildSummary(sorted, missingRecords, lowBalance),
    card: buildStatsCard('今日工作台', textLines.join('\n'), [
      { label: '今日全部', value: sorted.length },
      { label: '待上课程', value: active.length },
      { label: '已完成', value: completed.length },
      { label: '待补记录', value: missingRecords.length },
      { label: '低课时学员', value: lowBalance.length }
    ])
  });
}

async function getMissingTrainingAnswer({ coachOpenid, clientDate }) {
  const missing = await getMissingTrainingRecords(coachOpenid, addDays(clientDate, -7), clientDate);
  if (!missing.length) {
    return answerResponse('最近 7 天没有发现已完成但未写训练记录的课程。', { intent: 'missing_training_records' });
  }
  const lines = missing.slice(0, 8).map(l => `${l.date} ${l.start_time || ''} ${l.student_name || '学员'}`);
  return answerResponse(`最近 7 天有 ${missing.length} 节课待补训练记录：\n${lines.join('\n')}`, {
    intent: 'missing_training_records',
    card: buildStatsCard('待补训练记录', '已完成但未写训练记录的课程', lines.map((line, index) => ({ label: `课程${index + 1}`, value: line })))
  });
}

async function getLowBalanceAnswer({ coachOpenid }) {
  const students = await getLowBalanceStudents(coachOpenid, 2);
  if (!students.length) {
    return answerResponse('当前没有剩余课时小于等于 2 的学员。', { intent: 'low_balance_students' });
  }
  const lines = students.slice(0, 10).map(s => `${s.name || '学员'}：剩余 ${Number(s.remaining_lessons || 0)} 节`);
  return answerResponse(`有 ${students.length} 名学员课时偏低：\n${lines.join('\n')}`, {
    intent: 'low_balance_students',
    card: buildStatsCard('低课时提醒', '建议上课前确认续课或沟通安排', lines.map((line, index) => ({ label: `学员${index + 1}`, value: line })))
  });
}

async function getOperationReview({ coachOpenid, clientDate, text }) {
  const range = /本月|这个月/.test(text) ? getMonthRange(clientDate) : getWeekRange(clientDate);
  const lessons = await getLessonsByRange(coachOpenid, range.startDate, range.endDate);
  const missing = await getMissingTrainingRecords(coachOpenid, range.startDate, range.endDate);
  const lowBalance = await getLowBalanceStudents(coachOpenid, 2);
  const completed = lessons.filter(l => l.status === 'completed');
  const cancelled = lessons.filter(l => l.status === 'cancelled');
  const pending = lessons.filter(l => l.status === 'pending' || l.status === 'confirmed');
  const textOut = [
    `${range.startDate} 到 ${range.endDate}：`,
    `课程 ${lessons.length} 节，已完成 ${completed.length} 节，待上 ${pending.length} 节，已取消 ${cancelled.length} 节。`,
    `未补训练记录 ${missing.length} 节，低课时学员 ${lowBalance.length} 名。`
  ].join('\n');
  return answerResponse(textOut, {
    intent: 'operation_review',
    card: buildStatsCard('运营复盘', textOut, [
      { label: '时间范围', value: `${range.startDate} 至 ${range.endDate}` },
      { label: '课程数', value: lessons.length },
      { label: '已完成', value: completed.length },
      { label: '未补记录', value: missing.length },
      { label: '低课时学员', value: lowBalance.length }
    ])
  });
}

async function getStudentAnswer({ coachOpenid, text, sourceContext }) {
  const candidates = await findStudentsByContextOrText(coachOpenid, sourceContext, text);
  if (!candidates.length) return followupResponse('你想查询哪位学员？请补充学员姓名。', { intent: 'query_student' });
  if (candidates.length > 1) return disambiguationResponse(candidates, '找到多名匹配学员，请补充更完整的姓名。', 'query_student');
  const s = candidates[0];
  return answerResponse(`${s.name} 当前剩余 ${Number(s.remaining_lessons || 0)} 节课。${s.location_preference ? `偏好地点：${s.location_preference}。` : ''}`, {
    intent: 'query_student',
    card: {
      card_type: 'analysis_card',
      title: '学员信息',
      summary: `${s.name} 的基础信息`,
      display_fields: [
        { label: '姓名', value: s.name || '' },
        { label: '剩余课时', value: Number(s.remaining_lessons || 0) },
        { label: '偏好地点', value: s.location_preference || '未设置' }
      ],
      target: { type: 'student', id: s._id }
    }
  });
}

async function getStudentAnalysis({ coachOpenid, text, sourceContext }) {
  const candidates = await findStudentsByContextOrText(coachOpenid, sourceContext, text);
  if (!candidates.length) return followupResponse('你想分析哪位学员？请补充学员姓名。', { intent: 'analyze_student' });
  if (candidates.length > 1) return disambiguationResponse(candidates, '找到多名匹配学员，请补充更完整的姓名。', 'analyze_student');
  const student = candidates[0];
  const lessons = await getRecentLessons(coachOpenid, student._id, 5);
  const records = await getRecordsForLessons(coachOpenid, lessons.map(l => l._id));
  if (!records.length) {
    return answerResponse(`${student.name} 最近 ${lessons.length} 节课里暂无训练记录，因此不能做确定性训练分析。`, {
      intent: 'analyze_student'
    });
  }
  const evidence = records.map(r => ({
    type: 'training_record',
    id: r._id,
    label: `${r.body_parts && r.body_parts.length ? r.body_parts.join('、') : '训练记录'}`
  }));
  const bodyParts = collectBodyParts(records);
  const textOut = [
    `基于 ${student.name} 最近 ${records.length} 条训练记录：`,
    bodyParts.length ? `主要训练部位：${bodyParts.join('、')}。` : '训练部位信息不完整。',
    records.length < lessons.length ? `注意：最近 ${lessons.length} 节课中只有 ${records.length} 节有训练记录，结论可能不完整。` : '记录覆盖较完整。'
  ].join('\n');
  return answerResponse(textOut, {
    intent: 'analyze_student',
    card: {
      card_type: 'analysis_card',
      title: `${student.name} 训练分析`,
      summary: textOut,
      display_fields: [
        { label: '最近课程', value: lessons.length },
        { label: '有记录课程', value: records.length },
        { label: '主要部位', value: bodyParts.join('、') || '暂无' }
      ],
      evidence,
      target: { type: 'student', id: student._id }
    }
  });
}

async function prepareCreateLesson({ coachOpenid, text, clientDate, sourceContext }) {
  const candidates = await findStudentsByContextOrText(coachOpenid, sourceContext, text);
  if (!candidates.length) return followupResponse('要给哪位学员排课？请补充学员姓名。', { intent: 'create_lesson' });
  if (candidates.length > 1) return disambiguationResponse(candidates, '找到多名匹配学员，请补充更完整的姓名后再排课。', 'create_lesson');
  const student = candidates[0];
  if (Number(student.remaining_lessons || 0) <= 0) {
    return refusalResponse(`${student.name} 当前剩余课时为 0，AI 不会创建课程。请先在学员详情页处理课时。`, { intent: 'create_lesson' });
  }

  const settings = await getCoachSettings(coachOpenid);
  const slots = parseScheduleSlots(text, clientDate, settings, student);
  if (!slots.date || !slots.start_time) {
    return followupResponse('还缺少明确日期或开始时间。你可以说“给王小明明天下午3点排一节课”。', { intent: 'create_lesson' });
  }
  const conflicts = await findLessonConflicts(coachOpenid, slots.date, slots.start_time, slots.end_time);
  if (conflicts.length) {
    return refusalResponse(`这个时间已有课程：${conflicts.map(l => `${l.start_time}-${l.end_time} ${l.student_name || ''}`).join('、')}。请换一个时间。`, { intent: 'create_lesson' });
  }

  const confirmation = await createConfirmation({
    coachOpenid,
    actionType: 'create_lesson',
    title: '确认排课',
    summary: `给 ${student.name} 创建 ${slots.date} ${slots.start_time}-${slots.end_time} 的课程`,
    displayFields: [
      { label: '学员', value: student.name || '' },
      { label: '时间', value: `${slots.date} ${slots.start_time}-${slots.end_time}` },
      { label: '地点', value: slots.location || '未指定' },
      { label: '剩余课时', value: Number(student.remaining_lessons || 0) }
    ],
    payload: {
      student_id: student._id,
      student_name: student.name || '',
      date: slots.date,
      start_time: slots.start_time,
      end_time: slots.end_time,
      location: slots.location || '',
      status: 'confirmed'
    },
    validationSnapshot: {
      remaining_lessons: Number(student.remaining_lessons || 0),
      conflict_count: conflicts.length
    },
    sourceInput: text
  });

  return confirmCardResponse('已生成排课确认卡。请核对后再执行。', confirmation, 'schedule_confirm_card', 'create_lesson');
}

async function prepareTrainingRecord({ coachOpenid, text, clientDate, sourceContext }) {
  let lesson = null;
  if (sourceContext && sourceContext.lesson_id) {
    lesson = await getOwnedLesson(coachOpenid, sourceContext.lesson_id);
  }
  const candidates = lesson ? [] : await findStudentsByContextOrText(coachOpenid, sourceContext, text);
  let student = lesson ? { _id: lesson.student_id, name: lesson.student_name } : null;
  if (!lesson) {
    if (!candidates.length) return followupResponse('要记录哪位学员的训练？请补充学员姓名。', { intent: 'create_training_record' });
    if (candidates.length > 1) return disambiguationResponse(candidates, '找到多名匹配学员，请补充更完整的姓名。', 'create_training_record');
    student = candidates[0];
    lesson = await findBestLessonForTraining(coachOpenid, student._id, clientDate);
  }
  if (!lesson) {
    return followupResponse('没有找到可关联的课程。请先排课，或从具体课程卡片进入训练记录。', { intent: 'create_training_record' });
  }
  const parsed = await parseTrainingTextWithModel(text);
  if (!parsed.body_parts.length && !parsed.exercises.length && !parsed.notes) {
    return followupResponse('我还没有识别出训练部位或动作。请补充类似“练背，高位下拉4组12次”。', { intent: 'create_training_record' });
  }
  const existing = await getTrainingRecordByLesson(coachOpenid, lesson._id);
  const selectedMode = sourceContext && sourceContext.training_record_mode;
  if (existing && selectedMode !== 'overwrite' && selectedMode !== 'append') {
    return choiceCardResponse('这节课已有训练记录，请先选择保存方式。', {
      card_type: 'training_record_mode_choice_card',
      title: '选择训练记录保存方式',
      summary: `${student.name || lesson.student_name || '学员'} ${lesson.date || clientDate} 已有训练记录`,
      display_fields: [
        { label: '学员', value: student.name || lesson.student_name || '' },
        { label: '课程', value: `${lesson.date || ''} ${lesson.start_time || ''}` },
        { label: '已有记录', value: existing._id || '已存在' },
        { label: '新内容', value: parsed.body_parts.join('、') || parsed.notes || '待保存内容' }
      ],
      options: [
        {
          id: 'overwrite',
          label: '覆盖原记录',
          text,
          source_context: {
            ...(sourceContext || {}),
            source: 'training_record_mode_choice',
            intent: 'create_training_record',
            lesson_id: lesson._id,
            student_id: lesson.student_id,
            training_record_mode: 'overwrite'
          }
        },
        {
          id: 'append',
          label: '追加到原记录',
          text,
          source_context: {
            ...(sourceContext || {}),
            source: 'training_record_mode_choice',
            intent: 'create_training_record',
            lesson_id: lesson._id,
            student_id: lesson.student_id,
            training_record_mode: 'append'
          }
        }
      ]
    }, 'create_training_record');
  }
  const actionType = existing && selectedMode === 'append' ? 'append_training_record' : 'save_training_record';
  const confirmation = await createConfirmation({
    coachOpenid,
    actionType,
    title: actionType === 'append_training_record' ? '确认追加训练记录' : '确认保存训练记录',
    summary: `${student.name || lesson.student_name || '学员'} ${lesson.date || clientDate} 的训练记录`,
    displayFields: [
      { label: '学员', value: student.name || lesson.student_name || '' },
      { label: '课程', value: `${lesson.date || ''} ${lesson.start_time || ''}` },
      { label: '训练部位', value: parsed.body_parts.join('、') || '未识别' },
      { label: '动作数', value: parsed.exercises.length },
      { label: '保存方式', value: actionType === 'append_training_record' ? '追加到已有记录' : (existing ? '覆盖原记录' : '新建记录') }
    ],
    payload: {
      lesson_id: lesson._id,
      student_id: lesson.student_id,
      body_parts: parsed.body_parts,
      exercises: parsed.exercises,
      notes: parsed.notes,
      raw_voice_text: text
    },
    validationSnapshot: {
      existing_record_id: existing ? existing._id : '',
      lesson_status: lesson.status || ''
    },
    sourceInput: text,
    sourceTranscript: sourceContext && sourceContext.source_transcript ? sourceContext.source_transcript : ''
  });
  return confirmCardResponse('已整理训练记录确认卡。请核对后再保存。', confirmation, 'training_record_draft_card', confirmation.action_type);
}

async function prepareUpdateLesson({ coachOpenid, text, clientDate, sourceContext }) {
  if (!sourceContext || !sourceContext.lesson_id) {
    return followupResponse('请从具体课程卡片进入 AI 后再修改课程时间或地点。', { intent: 'update_lesson' });
  }
  const lesson = await getOwnedLesson(coachOpenid, sourceContext.lesson_id);
  if (!lesson) return refusalResponse('没有找到这节课，或它不属于当前教练。', { intent: 'update_lesson' });
  if (lesson.status !== 'pending' && lesson.status !== 'confirmed') {
    return refusalResponse('只有待上课程可以通过 AI 生成修改确认卡。', { intent: 'update_lesson' });
  }

  const settings = await getCoachSettings(coachOpenid);
  const slots = parseScheduleSlots(text, clientDate, settings, {
    location_preference: lesson.location || ''
  });
  const nextDate = slots.date || lesson.date || clientDate;
  const nextStart = slots.start_time || lesson.start_time || '';
  const nextEnd = slots.start_time ? slots.end_time : (lesson.end_time || '');
  const nextLocation = slots.location || lesson.location || '';

  if (!nextStart || !nextEnd) {
    return followupResponse('请补充新的上课时间，例如“改到明天下午 3 点”。', { intent: 'update_lesson' });
  }
  const changed = nextDate !== (lesson.date || '')
    || nextStart !== (lesson.start_time || '')
    || nextEnd !== (lesson.end_time || '')
    || nextLocation !== (lesson.location || '');
  if (!changed) {
    return followupResponse('没有识别到需要修改的时间或地点，请补充更明确的调整内容。', { intent: 'update_lesson' });
  }

  const conflicts = await findLessonConflicts(coachOpenid, nextDate, nextStart, nextEnd, lesson._id);
  if (conflicts.length) {
    return refusalResponse(`修改后的时间段与已有课程冲突：${conflicts.map(l => `${l.start_time}-${l.end_time} ${l.student_name || ''}`).join('、')}。`, { intent: 'update_lesson' });
  }

  const confirmation = await createConfirmation({
    coachOpenid,
    actionType: 'update_lesson',
    title: '确认修改课程',
    summary: `修改 ${lesson.student_name || '学员'} 的课程安排`,
    displayFields: [
      { label: '学员', value: lesson.student_name || '' },
      { label: '原时间', value: `${lesson.date || ''} ${lesson.start_time || ''}-${lesson.end_time || ''}` },
      { label: '新时间', value: `${nextDate} ${nextStart}-${nextEnd}` },
      { label: '地点', value: nextLocation || '未指定' }
    ],
    payload: {
      lesson_id: lesson._id,
      date: nextDate,
      start_time: nextStart,
      end_time: nextEnd,
      location: nextLocation
    },
    validationSnapshot: {
      previous_date: lesson.date || '',
      previous_start_time: lesson.start_time || '',
      previous_end_time: lesson.end_time || '',
      previous_location: lesson.location || '',
      conflict_count: conflicts.length,
      lesson_status: lesson.status || ''
    },
    sourceInput: text
  });
  return confirmCardResponse('已生成改课确认卡。请核对后再执行。', confirmation, 'lesson_update_confirm_card', 'update_lesson');
}

async function prepareCancelLesson({ coachOpenid, text, sourceContext }) {
  if (!sourceContext || !sourceContext.lesson_id) {
    return followupResponse('要取消哪一节课？请从具体课程卡片进入 AI，或补充明确课程信息。', { intent: 'cancel_lesson' });
  }
  const lesson = await getOwnedLesson(coachOpenid, sourceContext.lesson_id);
  if (!lesson) return refusalResponse('没有找到这节课，或它不属于当前教练。', { intent: 'cancel_lesson' });
  if (lesson.status !== 'pending' && lesson.status !== 'confirmed') {
    return refusalResponse('只有待确认或已确认的待上课程可以通过 AI 生成取消确认卡。', { intent: 'cancel_lesson' });
  }
  const reason = extractNoteText(text) || 'AI 确认卡取消';
  const confirmation = await createConfirmation({
    coachOpenid,
    actionType: 'cancel_lesson',
    title: '确认取消课程',
    summary: `取消 ${lesson.student_name || '学员'} ${lesson.date || ''} ${lesson.start_time || ''} 的课程`,
    displayFields: [
      { label: '学员', value: lesson.student_name || '' },
      { label: '时间', value: `${lesson.date || ''} ${lesson.start_time || ''}-${lesson.end_time || ''}` },
      { label: '原因', value: reason }
    ],
    payload: {
      lesson_id: lesson._id,
      cancel_reason: reason
    },
    validationSnapshot: {
      lesson_status: lesson.status || ''
    },
    sourceInput: text
  });
  return confirmCardResponse('已生成取消课程确认卡。请核对后再执行。', confirmation, 'lesson_cancel_confirm_card', 'cancel_lesson');
}

async function prepareStudentNoteUpdate({ coachOpenid, text, sourceContext }) {
  const candidates = await findStudentsByContextOrText(coachOpenid, sourceContext, text);
  if (!candidates.length) return followupResponse('要更新哪位学员的备注？请补充学员姓名。', { intent: 'update_student_note' });
  if (candidates.length > 1) return disambiguationResponse(candidates, '找到多名匹配学员，请补充更完整的姓名。', 'update_student_note');
  const student = candidates[0];
  const note = extractNoteText(text);
  if (!note) return followupResponse('请补充要写入备注的具体内容。', { intent: 'update_student_note' });
  const confirmation = await createConfirmation({
    coachOpenid,
    actionType: 'update_student_note',
    title: '确认更新学员备注',
    summary: `更新 ${student.name || '学员'} 的备注`,
    displayFields: [
      { label: '学员', value: student.name || '' },
      { label: '备注', value: note }
    ],
    payload: {
      student_id: student._id,
      notes: note
    },
    validationSnapshot: {
      previous_note_length: String(student.notes || '').length
    },
    sourceInput: text
  });
  return confirmCardResponse('已生成学员备注确认卡。请核对后再保存。', confirmation, 'student_note_confirm_card', 'update_student_note');
}

function parseScheduleSlots(text, clientDate, settings, student) {
  const duration = Number(settings && settings.lesson_duration) || 60;
  const date = parseDateFromText(text, clientDate);
  const start = parseTimeFromText(text);
  const end = start ? addMinutes(start, duration) : '';
  const location = parseLocation(text)
    || student.location_preference
    || (settings && settings.common_locations && settings.common_locations[0])
    || '';
  return { date, start_time: start, end_time: end, location };
}

function parseDateFromText(text, clientDate) {
  if (/后天/.test(text)) return addDays(clientDate, 2);
  if (/明天|明日/.test(text)) return addDays(clientDate, 1);
  if (/今天|今日/.test(text)) return clientDate;
  const full = text.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
  const md = text.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (md) return `${clientDate.slice(0, 4)}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
  return '';
}

function parseTimeFromText(text) {
  const half = /(上午|中午|下午|晚上|早上)?\s*(\d{1,2})\s*[点:：]\s*(半|\d{1,2}分?)?/.exec(text);
  if (!half) return '';
  let hour = Number(half[2]);
  let minute = 0;
  if (half[3] === '半') minute = 30;
  if (half[3] && /\d/.test(half[3])) minute = Number(half[3].replace(/\D/g, '')) || 0;
  const period = half[1] || '';
  if ((period === '下午' || period === '晚上') && hour < 12) hour += 12;
  if (period === '中午' && hour < 11) hour += 12;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function addMinutes(timeText, minutes) {
  const [h, m] = timeText.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function parseLocation(text) {
  const match = text.match(/(?:地点|在|到)([\u4e00-\u9fa5A-Za-z0-9号楼室馆店 -]{2,20})(?:上课|训练|。|，|,|$)/);
  return match ? match[1].trim() : '';
}

function parseTrainingText(text) {
  const bodyParts = [];
  const bodyMap = [
    ['胸部', /胸|卧推|飞鸟/],
    ['背部', /背|高位下拉|划船|引体/],
    ['腿部', /腿|深蹲|硬拉|腿举/],
    ['肩部', /肩|推举|侧平举/],
    ['手臂', /手臂|二头|三头|弯举/],
    ['核心', /核心|卷腹|平板/],
    ['有氧', /有氧|跑步|椭圆机/]
  ];
  bodyMap.forEach(([name, reg]) => {
    if (reg.test(text)) bodyParts.push(name);
  });

  const exercises = [];
  const chunks = text.split(/[，,。；;]/).map(s => s.trim()).filter(Boolean);
  chunks.forEach(chunk => {
    const match = chunk.match(/([\u4e00-\u9fa5A-Za-z ]{2,20})\s*(\d+)\s*组\s*(\d+)\s*(?:次|个)?\s*([0-9.]+\s*(?:kg|KG|公斤))?/);
    if (match) {
      exercises.push({
        name: match[1].replace(/^(记录|今天|练|训练|和|以及)/, '').trim(),
        sets: Number(match[2]) || 0,
        reps: Number(match[3]) || 0,
        weight: match[4] || ''
      });
    }
  });

  const notes = chunks
    .filter(chunk => !/\d+\s*组/.test(chunk))
    .filter(chunk => !/(记录|今天|练胸|练背|练腿|练肩)/.test(chunk))
    .join('，');

  return {
    body_parts: Array.from(new Set(bodyParts)),
    exercises,
    notes
  };
}

async function parseTrainingTextWithModel(text) {
  const fallback = parseTrainingText(text);
  if (!modelAdapter.isConfigured()) return fallback;
  try {
    const modelRes = await modelAdapter.parseTrainingRecord(text);
    if (modelRes.ok && modelRes.data) {
      return {
        body_parts: modelRes.data.body_parts.length ? modelRes.data.body_parts : fallback.body_parts,
        exercises: modelRes.data.exercises.length ? modelRes.data.exercises : fallback.exercises,
        notes: modelRes.data.notes || fallback.notes
      };
    }
  } catch (err) {
    console.warn('model parse fallback:', err.message);
  }
  return fallback;
}

async function findStudentsByText(coachOpenid, text) {
  const all = await getStudents(coachOpenid);
  const cleanText = text.replace(/\s+/g, '');
  const matched = all.filter(s => s.name && cleanText.includes(String(s.name).replace(/\s+/g, '')));
  if (matched.length) return matched;

  const nameGuess = guessName(text);
  if (!nameGuess) return [];
  return all.filter(s => s.name && s.name.includes(nameGuess));
}

async function findStudentsByContextOrText(coachOpenid, sourceContext, text) {
  if (sourceContext && sourceContext.student_id) {
    const res = await db.collection('students').doc(sourceContext.student_id).get();
    const student = res.data;
    if (student && student.coach_openid === coachOpenid) return [student];
    return [];
  }
  const slotName = sourceContext && sourceContext.ai_slots && sourceContext.ai_slots.student_name;
  if (slotName) {
    const all = await getStudents(coachOpenid);
    const cleanSlot = String(slotName).replace(/\s+/g, '');
    const matched = all.filter(s => s.name && String(s.name).replace(/\s+/g, '').includes(cleanSlot));
    if (matched.length) return matched;
  }
  return findStudentsByText(coachOpenid, text);
}

function extractNoteText(text) {
  const patterns = [
    /备注[为是:]?(.+)$/,
    /记一下(.+)$/,
    /记录一下(.+)$/,
    /原因[为是:]?(.+)$/,
    /取消.*课[，, ]*(.+)$/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return '';
}

function guessName(text) {
  const match = text.match(/(?:给|记录|查询|分析|问问|帮我看|帮我补)?([\u4e00-\u9fa5A-Za-z0-9]{1,12})(?:今天|明天|后天|最近|这节课|的|练|排课|训练|怎么样|$)/);
  if (!match) return '';
  return match[1]
    .replace(/^(某个|哪个|哪位|学员|这位|帮我|记录|查询|分析|问问|看一下)/g, '')
    .replace(/(今天|明天|后天|最近|训练|排课|练得|的)$/g, '');
}

async function getStudents(coachOpenid) {
  const res = await db.collection('students')
    .where({ coach_openid: coachOpenid })
    .limit(100)
    .get();
  return res.data || [];
}

async function getCoachSettings(coachOpenid) {
  const res = await db.collection('coach_settings')
    .where({ openid: coachOpenid })
    .limit(1)
    .get();
  return (res.data && res.data[0]) || null;
}

async function getLessonsByRange(coachOpenid, startDate, endDate) {
  const res = await db.collection('lessons')
    .where({
      coach_openid: coachOpenid,
      date: _.gte(startDate).and(_.lte(endDate))
    })
    .orderBy('date', 'asc')
    .orderBy('start_time', 'asc')
    .limit(100)
    .get();
  return res.data || [];
}

async function getRecentLessons(coachOpenid, studentId, limit) {
  const res = await db.collection('lessons')
    .where({ coach_openid: coachOpenid, student_id: studentId })
    .orderBy('date', 'desc')
    .orderBy('start_time', 'desc')
    .limit(limit || 5)
    .get();
  return res.data || [];
}

async function getRecordsForLessons(coachOpenid, lessonIds) {
  if (!lessonIds.length) return [];
  const res = await db.collection('training_records')
    .where({
      coach_openid: coachOpenid,
      lesson_id: _.in(lessonIds)
    })
    .limit(100)
    .get();
  return res.data || [];
}

async function getTrainingRecordByLesson(coachOpenid, lessonId) {
  const res = await db.collection('training_records')
    .where({ coach_openid: coachOpenid, lesson_id: lessonId })
    .limit(1)
    .get();
  return (res.data && res.data[0]) || null;
}

async function getMissingTrainingRecords(coachOpenid, startDate, endDate) {
  const lessons = (await getLessonsByRange(coachOpenid, startDate, endDate))
    .filter(l => l.status === 'completed');
  const records = await getRecordsForLessons(coachOpenid, lessons.map(l => l._id));
  const existing = new Set(records.map(r => r.lesson_id));
  return lessons.filter(l => !existing.has(l._id));
}

async function getLowBalanceStudents(coachOpenid, threshold) {
  const res = await db.collection('students')
    .where({
      coach_openid: coachOpenid,
      remaining_lessons: _.lte(threshold)
    })
    .orderBy('remaining_lessons', 'asc')
    .limit(100)
    .get();
  return res.data || [];
}

async function findLessonConflicts(coachOpenid, date, startTime, endTime, excludeLessonId = '') {
  const lessons = await getLessonsByRange(coachOpenid, date, date);
  return lessons.filter(l => {
    if (l.status === 'cancelled') return false;
    if (excludeLessonId && l._id === excludeLessonId) return false;
    return startTime < (l.end_time || l.start_time) && endTime > (l.start_time || l.end_time);
  });
}

async function findBestLessonForTraining(coachOpenid, studentId, clientDate) {
  const today = await getLessonsByRange(coachOpenid, clientDate, clientDate);
  const match = today
    .filter(l => l.student_id === studentId)
    .sort(sortLessonTime)
    .find(l => l.status === 'completed' || l.status === 'confirmed' || l.status === 'pending');
  if (match) return match;
  const recent = await getRecentLessons(coachOpenid, studentId, 5);
  return recent.find(l => l.status === 'completed' || l.status === 'confirmed') || null;
}

async function getOwnedLesson(coachOpenid, lessonId) {
  const res = await db.collection('lessons').doc(lessonId).get();
  const lesson = res.data;
  if (!lesson || lesson.coach_openid !== coachOpenid) return null;
  return lesson;
}

function sortLessonTime(a, b) {
  return `${a.date || ''} ${a.start_time || ''}`.localeCompare(`${b.date || ''} ${b.start_time || ''}`);
}

function collectBodyParts(records) {
  const parts = [];
  records.forEach(r => {
    (r.body_parts || []).forEach(p => parts.push(p));
  });
  return Array.from(new Set(parts));
}

function buildSummary(lessons, missingRecords, lowBalance) {
  const active = lessons.filter(l => l.status === 'pending' || l.status === 'confirmed');
  const completed = lessons.filter(l => l.status === 'completed');
  const next = active.slice().sort(sortLessonTime)[0];
  return {
    total: lessons.length,
    remaining: active.length,
    completed: completed.length,
    missingRecords: missingRecords.length,
    lowBalance: lowBalance.length,
    nextText: next ? `下一节 ${next.start_time || ''} ${next.student_name || '学员'}` : '暂无待上课程'
  };
}

function buildStatsCard(title, summary, displayFields) {
  return {
    card_type: 'stats_card',
    title,
    summary,
    display_fields: displayFields,
    target: { type: 'lessons' }
  };
}

async function createConfirmation(data) {
  const now = new Date();
  const doc = {
    coach_openid: data.coachOpenid,
    status: 'pending',
    action_type: data.actionType,
    title: data.title,
    summary: data.summary,
    display_fields: data.displayFields,
    payload: data.payload,
    validation_snapshot: data.validationSnapshot || {},
    source_input: data.sourceInput || '',
    source_transcript: data.sourceTranscript || '',
    expires_at: new Date(now.getTime() + CONFIRM_TTL_MS),
    created_at: now,
    updated_at: now
  };
  const res = await db.collection('ai_confirmations').add({ data: doc });
  return { ...doc, _id: res._id };
}

function confirmCardResponse(text, confirmation, cardType, actionType) {
  return {
    success: true,
    messageId: `ai_msg_${Date.now()}`,
    type: RESPONSE_TYPES.CONFIRM_CARD,
    intent: actionType,
    text,
    card: {
      card_type: cardType,
      confirmation_id: confirmation._id,
      action_type: confirmation.action_type,
      title: confirmation.title,
      summary: confirmation.summary,
      display_fields: confirmation.display_fields,
      expires_at: confirmation.expires_at
    }
  };
}

function choiceCardResponse(text, card, intent) {
  return {
    success: true,
    messageId: `ai_msg_${Date.now()}`,
    type: RESPONSE_TYPES.CHOICE_CARD,
    intent,
    text,
    card
  };
}

function answerResponse(text, extra = {}) {
  return {
    success: true,
    messageId: `ai_msg_${Date.now()}`,
    type: RESPONSE_TYPES.ANSWER,
    text,
    ...extra
  };
}

function followupResponse(text, extra = {}) {
  return {
    success: true,
    messageId: `ai_msg_${Date.now()}`,
    type: RESPONSE_TYPES.FOLLOWUP,
    text,
    ...extra
  };
}

function refusalResponse(text, extra = {}) {
  return {
    success: true,
    messageId: `ai_msg_${Date.now()}`,
    type: RESPONSE_TYPES.REFUSAL,
    text,
    ...extra
  };
}

function errorResponse(text, error) {
  return {
    success: false,
    messageId: `ai_msg_${Date.now()}`,
    type: RESPONSE_TYPES.ERROR,
    text,
    error: error || text
  };
}

function disambiguationResponse(candidates, text, intent) {
  return followupResponse(`${text}\n${candidates.slice(0, 5).map(s => `- ${s.name}，剩余 ${Number(s.remaining_lessons || 0)} 节`).join('\n')}`, { intent });
}

async function persistConversation(coachOpenid, userText, result, sourceContext) {
  try {
    const now = new Date();
    const convRes = await db.collection('ai_conversations')
      .where({ coach_openid: coachOpenid, title: '当前会话' })
      .limit(1)
      .get();
    let conversationId = convRes.data && convRes.data[0] && convRes.data[0]._id;
    if (!conversationId) {
      const addRes = await db.collection('ai_conversations').add({
        data: {
          coach_openid: coachOpenid,
          title: '当前会话',
          last_message: userText,
          message_count: 0,
          created_at: now,
          updated_at: now
        }
      });
      conversationId = addRes._id;
    } else {
      await db.collection('ai_conversations').doc(conversationId).update({
        data: {
          last_message: result.text || userText,
          message_count: _.inc(2),
          updated_at: now
        }
      });
    }
    await db.collection('ai_messages').add({
      data: {
        conversation_id: conversationId,
        coach_openid: coachOpenid,
        role: 'user',
        type: 'text',
        text: userText,
        card_ref: '',
        source_context: sourceContext || {},
        created_at: now
      }
    });
    await db.collection('ai_messages').add({
      data: {
        conversation_id: conversationId,
        coach_openid: coachOpenid,
        role: 'assistant',
        type: result.type || '',
        text: result.text || '',
        card_ref: result.card && result.card.confirmation_id ? result.card.confirmation_id : '',
        source_context: sourceContext || {},
        created_at: new Date()
      }
    });
    await pruneMessages(conversationId, coachOpenid);
  } catch (err) {
    console.warn('persistConversation skipped:', err.message);
  }
}

async function pruneMessages(conversationId, coachOpenid) {
  try {
    const res = await db.collection('ai_messages')
      .where({ conversation_id: conversationId, coach_openid: coachOpenid })
      .orderBy('created_at', 'desc')
      .skip(20)
      .limit(20)
      .get();
    await Promise.all((res.data || []).map(item => db.collection('ai_messages').doc(item._id).remove()));
  } catch (err) {
    console.warn('pruneMessages skipped:', err.message);
  }
}

async function logCall(data) {
  try {
    await db.collection('ai_call_logs').add({
      data: {
        coach_openid: data.coachOpenid || '',
        request_type: data.requestType || '',
        input_length: data.inputLength || 0,
        intent: data.intent || '',
        model: data.model || '',
        success: !!data.success,
        error_message: data.errorMessage || '',
        usage: data.usage || {},
        latency_ms: data.latencyMs || 0,
        created_at: new Date()
      }
    });
  } catch (err) {
    console.warn('logCall skipped:', err.message);
  }
}
