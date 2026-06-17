const AI_RESPONSE_TYPES = {
  ANSWER: 'answer',
  FOLLOWUP: 'followup',
  DRAFT_CARD: 'draft_card',
  CONFIRM_CARD: 'confirm_card',
  CHOICE_CARD: 'choice_card',
  RESULT_CARD: 'result_card',
  REFUSAL: 'refusal',
  ERROR: 'error'
};

const AI_CARD_TYPES = {
  SCHEDULE_CONFIRM: 'schedule_confirm_card',
  TRAINING_RECORD_DRAFT: 'training_record_draft_card',
  TRAINING_RECORD_MODE_CHOICE: 'training_record_mode_choice_card',
  LESSON_UPDATE_CONFIRM: 'lesson_update_confirm_card',
  LESSON_CANCEL_CONFIRM: 'lesson_cancel_confirm_card',
  STUDENT_NOTE_CONFIRM: 'student_note_confirm_card',
  ANALYSIS: 'analysis_card',
  STATS: 'stats_card',
  RESULT: 'result_card'
};

const QUICK_ACTIONS = [
  { id: 'today', label: '今日总结', prompt: '今天怎么样？' },
  { id: 'schedule', label: '安排课程', prompt: '给学员明天下午3点排一节课' },
  { id: 'record', label: '记录训练', prompt: '记录学员今天的训练' },
  { id: 'student', label: '查询学员', prompt: '某个学员最近练得怎么样？' },
  { id: 'missing', label: '补训练记录', prompt: '有哪些已完成但没写训练记录的课？' },
  { id: 'lowBalance', label: '低课时提醒', prompt: '哪些学员快没课了？' }
];

module.exports = {
  AI_RESPONSE_TYPES,
  AI_CARD_TYPES,
  QUICK_ACTIONS
};
