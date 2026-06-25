const LESSON_STATUS = {
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled"
};

const SUMMARY_STATUS = {
  NONE: "none",
  COMPLETED: "completed"
};

const CONFIRMATION_STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  FAILED: "failed"
};

const AI_RESPONSE_TYPE = {
  ANSWER: "answer",
  FOLLOWUP: "followup",
  DRAFT_CARD: "draft_card",
  CONFIRM_CARD: "confirm_card",
  RESULT_CARD: "result_card",
  REFUSAL: "refusal",
  ERROR: "error"
};

const LESSON_UNITS = [0.5, 1, 1.5, 2];

module.exports = {
  LESSON_STATUS,
  SUMMARY_STATUS,
  CONFIRMATION_STATUS,
  AI_RESPONSE_TYPE,
  LESSON_UNITS
};
