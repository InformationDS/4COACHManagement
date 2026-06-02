// utils/date.js - 日期时间处理工具

/**
 * 格式化日期为 YYYY-MM-DD
 * @param {Date|string|number} date
 * @returns {string}
 */
function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化时间为 HH:MM
 * @param {Date|string|number} date
 * @returns {string}
 */
function formatTime(date) {
  const d = new Date(date);
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${hour}:${min}`;
}

/**
 * 格式化日期时间为 YYYY-MM-DD HH:MM
 * @param {Date|string|number} date
 * @returns {string}
 */
function formatDateTime(date) {
  return `${formatDate(date)} ${formatTime(date)}`;
}

/**
 * 获取中文星期
 * @param {Date|string|number} date
 * @returns {string}
 */
function getWeekdayName(date) {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[new Date(date).getDay()];
}

/**
 * 获取当月天数
 * @param {number} year
 * @param {number} month (1-12)
 * @returns {number}
 */
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * 获取当月第一天是周几
 * @param {number} year
 * @param {number} month (1-12)
 * @returns {number} 0=周日, ..., 6=周六
 */
function getFirstDayOfMonth(year, month) {
  return new Date(year, month - 1, 1).getDay();
}

/**
 * 生成日历数据（用于日历组件）
 * @param {number} year
 * @param {number} month (1-12)
 * @returns {Array<{ date: string, day: number, isCurrentMonth: boolean, isToday: boolean }>}
 */
function generateCalendar(year, month) {
  const today = formatDate(new Date());
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const daysInPrevMonth = getDaysInMonth(year, month - 1 || 12);

  const calendar = [];

  // 填充上月尾日
  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const prevMonth = month - 1 || 12;
    const prevYear = month === 1 ? year - 1 : year;
    const dateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendar.push({
      date: dateStr,
      day,
      isCurrentMonth: false,
      isToday: dateStr === today
    });
  }

  // 本月日期
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendar.push({
      date: dateStr,
      day,
      isCurrentMonth: true,
      isToday: dateStr === today
    });
  }

  // 填充下月头日
  const remaining = 42 - calendar.length; // 6行 × 7列
  for (let day = 1; day <= remaining; day++) {
    const nextMonth = month + 1 > 12 ? 1 : month + 1;
    const nextYear = month + 1 > 12 ? year + 1 : year;
    const dateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendar.push({
      date: dateStr,
      day,
      isCurrentMonth: false,
      isToday: dateStr === today
    });
  }

  return calendar;
}

/**
 * 生成时间格子列表（根据起止时间和间隔）
 * @param {string} startTime - 如 "08:00"
 * @param {string} endTime - 如 "18:00"
 * @param {number} intervalMinutes - 间隔分钟
 * @returns {string[]}
 */
function generateTimeSlots(startTime, endTime, intervalMinutes) {
  const slots = [];
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  let h = startH;
  let m = startM;

  while (h < endH || (h === endH && m < endM)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += intervalMinutes;
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
  }

  return slots;
}

/**
 * 判断是否为今天
 * @param {string} dateStr - YYYY-MM-DD 格式
 * @returns {boolean}
 */
function isToday(dateStr) {
  return dateStr === formatDate(new Date());
}

/**
 * 判断日期是否已过
 * @param {string} dateStr - YYYY-MM-DD 格式
 * @returns {boolean}
 */
function isPast(dateStr) {
  return dateStr < formatDate(new Date());
}

module.exports = {
  formatDate,
  formatTime,
  formatDateTime,
  getWeekdayName,
  getDaysInMonth,
  getFirstDayOfMonth,
  generateCalendar,
  generateTimeSlots,
  isToday,
  isPast
};
