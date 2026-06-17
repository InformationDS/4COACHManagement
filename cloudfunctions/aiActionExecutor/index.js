const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const FORBIDDEN_ACTIONS = new Set([
  'adjust_lesson_balance',
  'complete_lesson',
  'delete_student',
  'delete_training_records',
  'send_external_message',
  'export_all_data',
  'modify_ai_config'
]);

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const coachOpenid = wxContext.OPENID;
  const { confirmationId } = event;
  const action = event.action || 'execute';

  if (!confirmationId) {
    return errorResult('缺少确认卡 ID');
  }

  try {
    const auth = await requireCoach(coachOpenid);
    if (!auth.ok) return errorResult('当前版本仅支持已注册教练执行 AI 确认卡。');

    const result = await db.runTransaction(async (transaction) => {
      const confirmationRes = await transaction.collection('ai_confirmations').doc(confirmationId).get();
      const confirmation = confirmationRes.data;
      const check = validateConfirmation(confirmation, coachOpenid);
      if (!check.ok) {
        if (check.status === 'expired' && confirmation && confirmation.status === 'pending') {
          await transaction.collection('ai_confirmations').doc(confirmationId).update({
            data: { status: 'expired', updated_at: new Date() }
          });
        }
        return errorResult(check.message);
      }

      if (action === 'cancel') {
        await transaction.collection('ai_confirmations').doc(confirmationId).update({
          data: {
            status: 'cancelled',
            cancelled_at: new Date(),
            updated_at: new Date()
          }
        });
        return {
          success: true,
          action_type: confirmation.action_type,
          target_type: 'ai_confirmation',
          target_id: confirmationId,
          message: '已取消本次确认。',
          display_fields: [
            { label: '确认卡', value: confirmation.title || confirmation.action_type || '' }
          ],
          target: { type: 'ai_confirmation', id: confirmationId }
        };
      }

      if (FORBIDDEN_ACTIONS.has(confirmation.action_type)) {
        return errorResult('该动作属于 AI 禁止执行范围。');
      }

      let execution;
      if (confirmation.action_type === 'create_lesson') {
        execution = await executeCreateLesson(transaction, confirmation, coachOpenid);
      } else if (confirmation.action_type === 'update_lesson') {
        execution = await executeUpdateLesson(transaction, confirmation, coachOpenid);
      } else if (confirmation.action_type === 'cancel_lesson') {
        execution = await executeCancelLesson(transaction, confirmation, coachOpenid);
      } else if (confirmation.action_type === 'save_training_record') {
        execution = await executeSaveTrainingRecord(transaction, confirmation, coachOpenid, false);
      } else if (confirmation.action_type === 'append_training_record') {
        execution = await executeSaveTrainingRecord(transaction, confirmation, coachOpenid, true);
      } else if (confirmation.action_type === 'update_student_note') {
        execution = await executeUpdateStudentNote(transaction, confirmation, coachOpenid);
      } else {
        execution = { success: false, message: '暂不支持该确认卡动作。' };
      }

      await transaction.collection('ai_confirmations').doc(confirmationId).update({
        data: {
          status: execution.success ? 'executed' : 'failed',
          execution_result: execution,
          updated_at: new Date()
        }
      });

      return execution;
    });

    await logAction({
      coachOpenid,
      confirmationId,
      actionType: result.action_type || '',
      targetType: result.target_type || '',
      targetId: result.target_id || '',
      success: !!result.success,
      errorMessage: result.success ? '' : (result.message || '')
    });

    if (!result.success) return result;
    return {
      success: true,
      type: 'result_card',
      text: result.message || '操作已完成。',
      card: {
        card_type: 'result_card',
        title: '执行成功',
        summary: result.message || '操作已完成。',
        display_fields: result.display_fields || [],
        target: result.target || {}
      }
    };
  } catch (err) {
    console.error('aiActionExecutor error:', err);
    await markConfirmationFailed(confirmationId, err.message);
    await logAction({
      coachOpenid,
      confirmationId,
      actionType: '',
      targetType: '',
      targetId: '',
      success: false,
      errorMessage: err.message || 'unknown'
    });
    return errorResult(err.message || '执行确认卡失败。');
  }
};

async function requireCoach(openid) {
  if (!openid) return { ok: false };
  const res = await db.collection('users')
    .where({ _openid: openid, role: 'coach' })
    .limit(1)
    .get();
  return { ok: res.data && res.data.length > 0 };
}

function validateConfirmation(confirmation, coachOpenid) {
  if (!confirmation) return { ok: false, message: '确认卡不存在。' };
  if (confirmation.coach_openid !== coachOpenid) return { ok: false, message: '无权执行该确认卡。' };
  if (confirmation.status !== 'pending') return { ok: false, message: '确认卡已处理或不可执行。' };
  if (isExpired(confirmation.expires_at)) return { ok: false, status: 'expired', message: '确认卡已过期，请重新生成。' };
  return { ok: true };
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}

async function executeCreateLesson(transaction, confirmation, coachOpenid) {
  const payload = confirmation.payload || {};
  const student = await getOwnedStudent(transaction, payload.student_id, coachOpenid);
  if (!student) return errorResult('学员不存在或不属于当前教练。');
  if (Number(student.remaining_lessons || 0) <= 0) return errorResult('学员剩余课时为 0，不能通过 AI 创建课程。');
  if (!payload.date || !payload.start_time || !payload.end_time) return errorResult('排课确认卡缺少日期或时间。');

  const conflicts = await findConflicts(transaction, coachOpenid, payload.date, payload.start_time, payload.end_time, '');
  if (conflicts.length) return errorResult('该时间段与已有课程冲突，未创建课程。');

  const now = new Date();
  const addRes = await transaction.collection('lessons').add({
    data: {
      student_id: student._id,
      student_name: student.name || payload.student_name || '',
      coach_openid: coachOpenid,
      date: payload.date,
      start_time: payload.start_time,
      end_time: payload.end_time,
      location: payload.location || '',
      status: 'confirmed',
      initiated_by: 'ai',
      ai_confirmation_id: confirmation._id,
      created_at: now,
      updated_at: now
    }
  });

  return {
    success: true,
    action_type: confirmation.action_type,
    target_type: 'lesson',
    target_id: addRes._id,
    message: `已为 ${student.name || '学员'} 创建 ${payload.date} ${payload.start_time}-${payload.end_time} 的课程。`,
    display_fields: [
      { label: '学员', value: student.name || '' },
      { label: '时间', value: `${payload.date} ${payload.start_time}-${payload.end_time}` },
      { label: '地点', value: payload.location || '未指定' }
    ],
    target: { type: 'lesson', id: addRes._id }
  };
}

async function executeUpdateLesson(transaction, confirmation, coachOpenid) {
  const payload = confirmation.payload || {};
  const lesson = await getOwnedLesson(transaction, payload.lesson_id, coachOpenid);
  if (!lesson) return errorResult('课程不存在或不属于当前教练。');
  if (lesson.status !== 'pending' && lesson.status !== 'confirmed') return errorResult('只有待上课程可以修改。');

  const date = payload.date || lesson.date;
  const startTime = payload.start_time || lesson.start_time;
  const endTime = payload.end_time || lesson.end_time;
  const conflicts = await findConflicts(transaction, coachOpenid, date, startTime, endTime, lesson._id);
  if (conflicts.length) return errorResult('修改后的时间段与已有课程冲突。');

  await transaction.collection('lessons').doc(lesson._id).update({
    data: {
      date,
      start_time: startTime,
      end_time: endTime,
      location: payload.location === undefined ? lesson.location || '' : payload.location,
      updated_at: new Date()
    }
  });

  return {
    success: true,
    action_type: confirmation.action_type,
    target_type: 'lesson',
    target_id: lesson._id,
    message: '课程已更新。',
    display_fields: [
      { label: '学员', value: lesson.student_name || '' },
      { label: '时间', value: `${date} ${startTime}-${endTime}` }
    ],
    target: { type: 'lesson', id: lesson._id }
  };
}

async function executeCancelLesson(transaction, confirmation, coachOpenid) {
  const payload = confirmation.payload || {};
  const lesson = await getOwnedLesson(transaction, payload.lesson_id, coachOpenid);
  if (!lesson) return errorResult('课程不存在或不属于当前教练。');
  if (lesson.status !== 'pending' && lesson.status !== 'confirmed') return errorResult('只有待上课程可以取消。');

  await transaction.collection('lessons').doc(lesson._id).update({
    data: {
      status: 'cancelled',
      cancel_by: 'ai_confirmed_by_coach',
      cancel_reason: payload.cancel_reason || 'AI 确认卡取消',
      updated_at: new Date()
    }
  });

  return {
    success: true,
    action_type: confirmation.action_type,
    target_type: 'lesson',
    target_id: lesson._id,
    message: '课程已取消。',
    display_fields: [
      { label: '学员', value: lesson.student_name || '' },
      { label: '课程', value: `${lesson.date || ''} ${lesson.start_time || ''}` }
    ],
    target: { type: 'lesson', id: lesson._id }
  };
}

async function executeSaveTrainingRecord(transaction, confirmation, coachOpenid, append) {
  const payload = confirmation.payload || {};
  const lesson = await getOwnedLesson(transaction, payload.lesson_id, coachOpenid);
  if (!lesson) return errorResult('课程不存在或不属于当前教练。');
  if (lesson.student_id !== payload.student_id) return errorResult('训练记录学员与课程不匹配。');

  const existingRes = await transaction.collection('training_records')
    .where({ coach_openid: coachOpenid, lesson_id: lesson._id })
    .limit(1)
    .get();
  const existing = existingRes.data && existingRes.data[0];
  const now = new Date();
  const cleanData = {
    lesson_id: lesson._id,
    student_id: lesson.student_id,
    coach_openid: coachOpenid,
    body_parts: normalizeArray(payload.body_parts),
    exercises: normalizeExercises(payload.exercises),
    notes: String(payload.notes || '').trim(),
    raw_voice_text: String(payload.raw_voice_text || ''),
    updated_at: now
  };

  let recordId;
  if (existing && append) {
    recordId = existing._id;
    await transaction.collection('training_records').doc(recordId).update({
      data: {
        body_parts: mergeUnique(existing.body_parts || [], cleanData.body_parts),
        exercises: [...(existing.exercises || []), ...cleanData.exercises],
        notes: [existing.notes, cleanData.notes].filter(Boolean).join('\n'),
        raw_voice_text: [existing.raw_voice_text, cleanData.raw_voice_text].filter(Boolean).join('\n'),
        updated_at: now
      }
    });
  } else if (existing) {
    recordId = existing._id;
    await transaction.collection('training_records').doc(recordId).update({ data: cleanData });
  } else {
    const addRes = await transaction.collection('training_records').add({
      data: {
        ...cleanData,
        created_at: now
      }
    });
    recordId = addRes._id;
  }

  return {
    success: true,
    action_type: confirmation.action_type,
    target_type: 'training_record',
    target_id: recordId,
    message: append && existing ? '训练记录已追加。' : '训练记录已保存。',
    display_fields: [
      { label: '学员', value: lesson.student_name || '' },
      { label: '课程', value: `${lesson.date || ''} ${lesson.start_time || ''}` },
      { label: '动作数', value: cleanData.exercises.length }
    ],
    target: { type: 'lesson', id: lesson._id }
  };
}

async function executeUpdateStudentNote(transaction, confirmation, coachOpenid) {
  const payload = confirmation.payload || {};
  const student = await getOwnedStudent(transaction, payload.student_id, coachOpenid);
  if (!student) return errorResult('学员不存在或不属于当前教练。');
  const notes = String(payload.notes || '').trim();
  await transaction.collection('students').doc(student._id).update({
    data: {
      notes,
      updated_at: new Date()
    }
  });
  return {
    success: true,
    action_type: confirmation.action_type,
    target_type: 'student',
    target_id: student._id,
    message: '学员备注已更新。',
    display_fields: [
      { label: '学员', value: student.name || '' },
      { label: '备注', value: notes }
    ],
    target: { type: 'student', id: student._id }
  };
}

async function getOwnedStudent(transaction, studentId, coachOpenid) {
  if (!studentId) return null;
  const res = await transaction.collection('students').doc(studentId).get();
  const student = res.data;
  if (!student || student.coach_openid !== coachOpenid) return null;
  return student;
}

async function getOwnedLesson(transaction, lessonId, coachOpenid) {
  if (!lessonId) return null;
  const res = await transaction.collection('lessons').doc(lessonId).get();
  const lesson = res.data;
  if (!lesson || lesson.coach_openid !== coachOpenid) return null;
  return lesson;
}

async function findConflicts(transaction, coachOpenid, date, startTime, endTime, excludeLessonId) {
  const res = await transaction.collection('lessons')
    .where({
      coach_openid: coachOpenid,
      date,
      status: _.neq('cancelled')
    })
    .limit(100)
    .get();
  return (res.data || []).filter(lesson => {
    if (excludeLessonId && lesson._id === excludeLessonId) return false;
    return startTime < (lesson.end_time || lesson.start_time) && endTime > (lesson.start_time || lesson.end_time);
  });
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function normalizeExercises(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && item.name)
    .map(item => ({
      name: String(item.name || '').trim(),
      sets: Number(item.sets || 0),
      reps: Number(item.reps || 0),
      weight: String(item.weight || '').trim()
    }));
}

function mergeUnique(a, b) {
  return Array.from(new Set([...(a || []), ...(b || [])].filter(Boolean)));
}

function errorResult(message) {
  return {
    success: false,
    type: 'error',
    text: message,
    message
  };
}

async function markConfirmationFailed(confirmationId, message) {
  try {
    await db.collection('ai_confirmations').doc(confirmationId).update({
      data: {
        status: 'failed',
        execution_result: { success: false, message },
        updated_at: new Date()
      }
    });
  } catch (err) {
    console.warn('markConfirmationFailed skipped:', err.message);
  }
}

async function logAction(data) {
  try {
    await db.collection('ai_action_logs').add({
      data: {
        coach_openid: data.coachOpenid || '',
        confirmation_id: data.confirmationId || '',
        action_type: data.actionType || '',
        target_type: data.targetType || '',
        target_id: data.targetId || '',
        success: !!data.success,
        error_message: data.errorMessage || '',
        created_at: new Date()
      }
    });
  } catch (err) {
    console.warn('logAction skipped:', err.message);
  }
}
