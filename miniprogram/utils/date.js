function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function formatTime(date) {
  const value = date instanceof Date ? date : new Date(date);
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function formatDateTime(date) {
  const value = date instanceof Date ? date : new Date(date);
  return `${formatDate(value)} ${formatTime(value)}`;
}

function addMinutes(date, minutes) {
  const value = date instanceof Date ? date : new Date(date);
  return new Date(value.getTime() + minutes * 60000);
}

function startOfDay(date) {
  const value = date instanceof Date ? date : new Date(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
}

function endOfDay(date) {
  const value = startOfDay(date);
  return new Date(value.getTime() + 24 * 60 * 60000 - 1);
}

function startOfWeek(date) {
  const value = startOfDay(date);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() - day + 1);
  return value;
}

function endOfWeek(date) {
  return endOfDay(addMinutes(startOfWeek(date), 6 * 24 * 60));
}

function combineDateTime(dateText, timeText) {
  const parts = (dateText || "").split("-").map(Number);
  const timeParts = (timeText || "").split(":").map(Number);
  if (parts.length !== 3 || timeParts.length < 2) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], timeParts[0], timeParts[1], 0, 0);
}

module.exports = {
  pad,
  formatDate,
  formatTime,
  formatDateTime,
  addMinutes,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  combineDateTime
};
