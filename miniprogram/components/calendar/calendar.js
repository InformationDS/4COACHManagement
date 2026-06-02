// components/calendar/calendar.js
const { generateCalendar, formatDate, getWeekdayName, isToday } = require('../../utils/date');

Component({
  properties: {
    lessons: { type: Array, value: [] },
    value: { type: String, value: '' }
  },

  data: {
    year: 2026,
    month: 6,
    viewMode: 'month',
    selectedDate: '',
    monthDays: [],
    weekDays: [],
    weekIndexStr: '',
    _lessonMap: {}       // 缓存 course 日期→状态映射
  },

  observers: {
    'value'(val) {
      // 只在值真正变化时同步
      if (val && val !== this.data.selectedDate) {
        this.setData({ selectedDate: val });
      }
    },
    'lessons'() {
      // 重新构建课程映射，刷到当前视图
      this._applyLessonDots();
    }
  },

  lifetimes: {
    attached() {
      const now = new Date();
      const today = formatDate(now);
      this.setData({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        selectedDate: this.data.value || today
      });
      this._render();
    }
  },

  methods: {
    // ===== 渲染 =====

    _render() {
      if (this.data.viewMode === 'month') {
        this._renderMonth();
      } else {
        this._renderWeek();
      }
    },

    _renderMonth() {
      const { year, month } = this.data;
      const days = generateCalendar(year, month);
      // 先构建课程映射，再直接应用到 days 上（避免 setData 异步导致的旧数据问题）
      const lessonMap = this._buildLessonMap();
      const monthDays = days.map(d => ({ ...d, ...this._getDayStatus(d.date, lessonMap) }));
      this.setData({ monthDays, _lessonMap: lessonMap });
    },

    _renderWeek() {
      const d = new Date(this.data.selectedDate);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));

      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        const wd = new Date(monday);
        wd.setDate(monday.getDate() + i);
        const dateStr = formatDate(wd);
        weekDays.push({
          date: dateStr,
          label: getWeekdayName(wd),
          day: wd.getDate(),
          isToday: isToday(dateStr)
        });
      }

      const startOfYear = new Date(monday.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((monday - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);

      const lessonMap = this._buildLessonMap();
      const weekDaysWithStatus = weekDays.map(d => ({ ...d, ...this._getDayStatus(d.date, lessonMap) }));
      this.setData({ weekDays: weekDaysWithStatus, weekIndexStr: String(weekNum), _lessonMap: lessonMap });
    },

    // ===== 课程映射 =====

    _buildLessonMap() {
      const map = {};
      (this.data.lessons || this.properties.lessons || []).forEach(l => {
        const d = typeof l.date === 'string' ? l.date : formatDate(l.date);
        if (!map[d]) map[d] = { pending: false, confirmed: false, cancelled: false, completed: false };
        if (l.status === 'pending') map[d].pending = true;
        if (l.status === 'confirmed') map[d].confirmed = true;
        if (l.status === 'cancelled') map[d].cancelled = true;
        if (l.status === 'completed') map[d].completed = true;
      });
      return map;
    },

    _getDayStatus(date, map) {
      const s = map[date];
      return {
        hasLessons: !!s,
        hasPending: s ? s.pending : false,
        hasConfirmed: s ? s.confirmed : false,
        hasCancelled: s ? s.cancelled : false,
        hasCompleted: s ? s.completed : false
      };
    },

    // 仅刷新色点（不重建整个日历）
    _applyLessonDots() {
      const { monthDays, weekDays, viewMode } = this.data;
      const lessonMap = this._buildLessonMap();
      if (viewMode === 'month' && monthDays.length) {
        this.setData({ monthDays: monthDays.map(d => ({ ...d, ...this._getDayStatus(d.date, lessonMap) })), _lessonMap: lessonMap });
      } else if (weekDays.length) {
        this.setData({ weekDays: weekDays.map(d => ({ ...d, ...this._getDayStatus(d.date, lessonMap) })), _lessonMap: lessonMap });
      }
    },

    // ===== 交互 =====

    onSelectDate(e) {
      const date = e.currentTarget.dataset.date;
      if (!date) return;
      // 如果是其他月份的日期，切换到对应月
      const clicked = this.data.monthDays.find(d => d.date === date);
      if (clicked && !clicked.isCurrentMonth) {
        const [y, m] = date.split('-');
        this.setData({ year: parseInt(y), month: parseInt(m) });
        this._renderMonth();
      }
      this.setData({ selectedDate: date });
      this.triggerEvent('change', { value: date });
    },

    onPrevMonth() {
      const { year, month, viewMode } = this.data;
      if (viewMode === 'month') {
        const m = month - 1;
        this.setData({
          year: m < 1 ? year - 1 : year,
          month: m < 1 ? 12 : m
        });
      } else {
        const d = new Date(this.data.selectedDate);
        d.setDate(d.getDate() - 7);
        this.setData({ selectedDate: formatDate(d) });
      }
      this._render();
    },

    onNextMonth() {
      const { year, month, viewMode } = this.data;
      if (viewMode === 'month') {
        const m = month + 1;
        this.setData({
          year: m > 12 ? year + 1 : year,
          month: m > 12 ? 1 : m
        });
      } else {
        const d = new Date(this.data.selectedDate);
        d.setDate(d.getDate() + 7);
        this.setData({ selectedDate: formatDate(d) });
      }
      this._render();
    },

    onToggleView() {
      const next = this.data.viewMode === 'month' ? 'week' : 'month';
      this.setData({ viewMode: next });
      this._render();
    }
  }
});
