const { AI_CARD_TYPES } = require('./aiConstants');

function getCardTheme(cardType) {
  const map = {
    [AI_CARD_TYPES.SCHEDULE_CONFIRM]: 'schedule',
    [AI_CARD_TYPES.TRAINING_RECORD_DRAFT]: 'training',
    [AI_CARD_TYPES.LESSON_UPDATE_CONFIRM]: 'schedule',
    [AI_CARD_TYPES.LESSON_CANCEL_CONFIRM]: 'warning',
    [AI_CARD_TYPES.STUDENT_NOTE_CONFIRM]: 'student',
    [AI_CARD_TYPES.ANALYSIS]: 'analysis',
    [AI_CARD_TYPES.STATS]: 'stats',
    [AI_CARD_TYPES.RESULT]: 'result'
  };
  return map[cardType] || 'default';
}

function getConfirmButtonText(actionType) {
  const map = {
    create_lesson: '确认排课',
    update_lesson: '确认修改',
    cancel_lesson: '确认取消',
    save_training_record: '保存记录',
    append_training_record: '追加记录',
    update_student_note: '保存备注'
  };
  return map[actionType] || '确认执行';
}

function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter(item => item && item.label)
    .map(item => ({
      label: String(item.label),
      value: item.value === undefined || item.value === null ? '' : String(item.value)
    }));
}

function buildRoute(card) {
  if (!card) return '';
  if (card.route) return card.route;
  const target = card.target || {};
  if (target.type === 'lesson' && target.id) {
    return `/pages/coach/training-record/training-record?lesson_id=${target.id}`;
  }
  if (target.type === 'student' && target.id) {
    return `/pages/coach/student-detail/student-detail?id=${target.id}`;
  }
  if (target.type === 'lessons') {
    return '/pages/coach/lessons/lessons';
  }
  return '';
}

module.exports = {
  getCardTheme,
  getConfirmButtonText,
  normalizeFields,
  buildRoute
};
