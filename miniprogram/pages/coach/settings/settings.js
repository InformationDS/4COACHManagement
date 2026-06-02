// pages/coach/settings/settings.js
const { getCoachSettings, saveCoachSettings, getStudents } = require('../../../utils/api');

// 星期名称
const WEEKDAY_NAMES = ['', '一', '二', '三', '四', '五', '六', '日'];

function formatBlockedTimes(blockedTimes) {
  const recurringBlocks = [];
  const dateBlocks = [];
  (blockedTimes || []).forEach((item, idx) => {
    if (item.type === 'recurring') {
      recurringBlocks.push({
        ...item,
        _idx: idx,
        daysText: (item.days || []).map(d => WEEKDAY_NAMES[d]).join('、'),
        timeText: `${item.start_time}-${item.end_time}`
      });
    } else {
      dateBlocks.push({
        ...item,
        _idx: idx,
        timeText: item.all_day ? '全天' : `${item.start_time}-${item.end_time}`
      });
    }
  });
  // 按星期排序循环规则
  recurringBlocks.sort((a, b) => (a.days || [])[0] - (b.days || [])[0]);
  // 按日期排序特定日期
  dateBlocks.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return { recurringBlocks, dateBlocks };
}

Page({
  data: {
    loading: true, saving: false,
    settings: {
      lesson_duration: 60,
      common_locations: [],
      blocked_times: [],
      daily_start_time: '08:00',
      daily_end_time: '20:00'
    },
    recurringBlocks: [],
    dateBlocks: [],

    newLocation: '',

    // 循环不可约弹窗
    recurringModal: false,
    recurringDays: [false, false, false, false, false, false, false], // 周一~周日是否选中
    recurringStartTime: '12:00',
    recurringEndTime: '13:00',
    recurringNote: '',

    // 特定日期不可约弹窗
    dateModal: false,
    dateBlockDate: '',
    dateBlockDateText: '请选择日期',
    dateBlockAllDay: false,
    dateBlockStartTime: '12:00',
    dateBlockEndTime: '13:00',
    dateBlockNote: '',

    // 避免 onShow 重复刷掉未保存编辑
    _firstLoad: true,

    // 调试
    studentNames: [],
    students: [],
    debugStudentIdx: 0
  },

  async onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(2);
    }
    if (this.data._firstLoad) {
      this.setData({ _firstLoad: false });
      await this.loadSettings();
    }
    await this.loadStudents();
  },

  async loadSettings() {
    this.setData({ loading: true });
    try {
      const s = await getCoachSettings();
      const blockedTimes = s ? (s.blocked_times || []) : [];
      const display = formatBlockedTimes(blockedTimes);
      this.setData({
        settings: {
          lesson_duration: s ? (s.lesson_duration || 60) : 60,
          common_locations: s ? (s.common_locations || []) : [],
          blocked_times: blockedTimes,
          daily_start_time: s ? (s.daily_start_time || '08:00') : '08:00',
          daily_end_time: s ? (s.daily_end_time || '20:00') : '20:00'
        },
        ...display,
        loading: false
      });
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
    }
  },

  async loadStudents() {
    try {
      const students = await getStudents();
      this.setData({
        studentNames: students.map(s => s.name),
        students
      });
    } catch (e) { /* ignore */ }
  },

  // ===== 课程时长 =====
  onDurationInput(e) {
    this.setData({ 'settings.lesson_duration': parseInt(e.detail.value) || 60 });
  },

  // ===== 每日工作时间 =====
  onDailyStartInput(e) { this.setData({ 'settings.daily_start_time': e.detail.value }); },
  onDailyEndInput(e) { this.setData({ 'settings.daily_end_time': e.detail.value }); },

  // ===== 常用地点 =====
  onLocationInput(e) { this.setData({ newLocation: e.detail.value }); },
  onAddLocation() {
    const v = this.data.newLocation.trim();
    if (!v) return;
    this.setData({
      'settings.common_locations': [...this.data.settings.common_locations, v],
      newLocation: ''
    });
  },
  onDeleteLocation(e) {
    const idx = e.currentTarget.dataset.index;
    const locs = [...this.data.settings.common_locations];
    locs.splice(idx, 1);
    this.setData({ 'settings.common_locations': locs });
  },

  // ===== 循环不可约（每周固定） =====
  onOpenRecurring() {
    this.setData({
      recurringModal: true,
      recurringDays: [false, false, false, false, false, false, false],
      recurringStartTime: '12:00',
      recurringEndTime: '13:00',
      recurringNote: ''
    });
  },
  onCloseRecurring() { this.setData({ recurringModal: false }); },

  onRecurringDayTap(e) {
    const dayIdx = parseInt(e.currentTarget.dataset.day); // 0=周一 ... 6=周日
    const key = `recurringDays[${dayIdx}]`;
    this.setData({ [key]: !this.data.recurringDays[dayIdx] });
  },
  onRecurringStartInput(e) { this.setData({ recurringStartTime: e.detail.value }); },
  onRecurringEndInput(e) { this.setData({ recurringEndTime: e.detail.value }); },
  onRecurringNoteInput(e) { this.setData({ recurringNote: e.detail.value }); },

  onConfirmRecurring() {
    const { recurringDays, recurringStartTime, recurringEndTime, recurringNote } = this.data;
    // 将选中的索引转为 1-7 的 weekday 数组
    const days = [];
    recurringDays.forEach((v, i) => { if (v) days.push(i + 1); });
    if (days.length === 0) { wx.showToast({ title: '请选择星期', icon: 'none' }); return; }
    if (!recurringStartTime || !recurringEndTime) { wx.showToast({ title: '请填写时间', icon: 'none' }); return; }
    if (recurringStartTime >= recurringEndTime) { wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' }); return; }

    const newItem = {
      type: 'recurring',
      days: days,
      start_time: recurringStartTime,
      end_time: recurringEndTime,
      note: recurringNote || ''
    };

    const blockedTimes = [...this.data.settings.blocked_times, newItem];
    const display = formatBlockedTimes(blockedTimes);
    this.setData({
      'settings.blocked_times': blockedTimes,
      ...display,
      recurringModal: false
    });
  },

  onDeleteRecurring(e) {
    const idx = e.currentTarget.dataset.index;
    const blockedTimes = [...this.data.settings.blocked_times];
    blockedTimes.splice(idx, 1);
    const display = formatBlockedTimes(blockedTimes);
    this.setData({
      'settings.blocked_times': blockedTimes,
      ...display
    });
  },

  // ===== 特定日期不可约 =====
  onOpenDateBlock() {
    this.setData({
      dateModal: true,
      dateBlockDate: '',
      dateBlockDateText: '请选择日期',
      dateBlockAllDay: false,
      dateBlockStartTime: '12:00',
      dateBlockEndTime: '13:00',
      dateBlockNote: ''
    });
  },
  onCloseDateModal() { this.setData({ dateModal: false }); },

  onDateChange(e) {
    const date = e.detail.value;
    const parts = date.split('-');
    const dateText = `${parseInt(parts[1])}月${parts[2]}日`;
    this.setData({
      dateBlockDate: date,
      dateBlockDateText: dateText
    });
  },
  onDateAllDayToggle() {
    this.setData({ dateBlockAllDay: !this.data.dateBlockAllDay });
  },
  onDateStartInput(e) { this.setData({ dateBlockStartTime: e.detail.value }); },
  onDateEndInput(e) { this.setData({ dateBlockEndTime: e.detail.value }); },
  onDateNoteInput(e) { this.setData({ dateBlockNote: e.detail.value }); },

  onConfirmDateBlock() {
    const { dateBlockDate, dateBlockAllDay, dateBlockStartTime, dateBlockEndTime, dateBlockNote } = this.data;
    if (!dateBlockDate) { wx.showToast({ title: '请选择日期', icon: 'none' }); return; }
    if (!dateBlockAllDay) {
      if (!dateBlockStartTime || !dateBlockEndTime) { wx.showToast({ title: '请填写时间', icon: 'none' }); return; }
      if (dateBlockStartTime >= dateBlockEndTime) { wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' }); return; }
    }

    const newItem = {
      type: 'date',
      date: dateBlockDate,
      all_day: dateBlockAllDay,
      start_time: dateBlockAllDay ? '' : dateBlockStartTime,
      end_time: dateBlockAllDay ? '' : dateBlockEndTime,
      note: dateBlockNote || ''
    };

    const blockedTimes = [...this.data.settings.blocked_times, newItem];
    const display = formatBlockedTimes(blockedTimes);
    this.setData({
      'settings.blocked_times': blockedTimes,
      ...display,
      dateModal: false
    });
  },

  onDeleteDateBlock(e) {
    const idx = e.currentTarget.dataset.index;
    const blockedTimes = [...this.data.settings.blocked_times];
    blockedTimes.splice(idx, 1);
    const display = formatBlockedTimes(blockedTimes);
    this.setData({
      'settings.blocked_times': blockedTimes,
      ...display
    });
  },

  // ===== 保存设置 =====

  async onSave() {
    this.setData({ saving: true });
    try {
      await saveCoachSettings(this.data.settings);
      wx.showToast({ title: '设置已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
    this.setData({ saving: false });
  },

  // ===== 开发者调试：切换学员视角 =====
  onDebugStudentChange(e) {
    this.setData({ debugStudentIdx: parseInt(e.detail.value) });
  },

  onSwitchToStudent() {
    const { students, debugStudentIdx } = this.data;
    const student = students[debugStudentIdx];
    if (!student) return;

    wx.showModal({
      title: '切换学员视角',
      content: `将以「${student.name}」的身份预览学员端。重新打开小程序自动恢复教练身份。`,
      success: (res) => {
        if (res.confirm) {
          const app = getApp();
          app.globalData.role = 'student';
          app.globalData.userInfo = {
            student_id: student._id,
            name: student.name,
            phone: student.phone || ''
          };
          wx.showToast({ title: '正在跳转学员端...', icon: 'none' });
          setTimeout(() => {
            wx.switchTab({ url: '/pages/student/booking/booking' });
          }, 500);
        }
      }
    });
  }
});
