function statusLabel(status) {
  const map = {
    confirmed: "已确认",
    completed: "已完成",
    cancelled: "已取消",
    none: "未完成",
    pending: "待确认",
    failed: "失败",
    expired: "已过期"
  };
  return map[status] || status || "未填写";
}

function cardTitle(card) {
  if (!card) return "";
  return card.title || card.summary || "AI 卡片";
}

function resultRoute(card) {
  if (!card || !card.route) return "";
  const params = card.route.params || {};
  if (card.route.page === "lesson-detail" && params.lesson_id) {
    return `/pages/coach/lesson-detail/lesson-detail?id=${params.lesson_id}`;
  }
  if (card.route.page === "student-detail" && params.student_id) {
    return `/pages/coach/student-detail/student-detail?id=${params.student_id}`;
  }
  return "";
}

module.exports = {
  statusLabel,
  cardTitle,
  resultRoute
};
