// pages/coach/settings/settings.js
const { getCoachSettings, saveCoachSettings, getStudents } = require('../../../utils/api');

Page({
  data: {
    loading: true, saving: false,
    settings: {
      lesson_duration: 60,
      common_locations: [],
      available_slots: [],
      blocked_times: []
    },
    templates: [],
    newLocation: '',
    templateVisible: false,
    newTemplate: { days: [], startTime: '08:00', endTime: '18:00' },

    // 调试
    studentNames: [],
    students: [],
    debugStudentIdx: 0
  },

  async onShow() {
    await this.loadSettings();
    await this.loadStudents();
  },

  async loadSettings() {
    this.setData({ loading: true });
    try {
      const s = await getCoachSettings();
      if (s) {
        const slots = s.available_slots || [];
        const templates = slots.map(t => ({
          ...t,
          daysText: (t.days || []).map(d => ['', '一','二','三','四','五','六','日'][d]).join('、')
        }));
        this.setData({
          settings: {
            lesson_duration: s.lesson_duration || 60,
            common_locations: s.common_locations || [],
            available_slots: slots,
            blocked_times: s.blocked_times || []
          },
          templates,
          loading: false
        });
      } else {
        this.setData({ loading: false });
      }
    } catch (e) { console.error(e); this.setData({ loading: false }); }
  },

  async loadStudents() {
    try {
      const students = await getStudents();
      const names = students.map(s => s.name);
      this.setData({ studentNames: names, students });
    } catch (e) { /* ignore */ }
  },

  onDurationInput(e) {
    this.setData({ 'settings.lesson_duration': parseInt(e.detail.value) || 60 });
  },

  onLocationInput(e) { this.setData({ newLocation: e.detail.value }); },
  onAddLocation() {
    const v = this.data.newLocation.trim();
    if (!v) return;
    this.setData({ 'settings.common_locations': [...this.data.settings.common_locations, v], newLocation: '' });
  },
  onDeleteLocation(e) {
    const idx = e.currentTarget.dataset.index;
    const locs = [...this.data.settings.common_locations];
    locs.splice(idx, 1);
    this.setData({ 'settings.common_locations': locs });
  },

  onAddTemplate() {
    this.setData({ templateVisible: true, newTemplate: { days: [], startTime: '08:00', endTime: '18:00' } });
  },
  onCloseTemplate() { this.setData({ templateVisible: false }); },
  onWeekdayTap(e) {
    const day = parseInt(e.currentTarget.dataset.day);
    let days = [...this.data.newTemplate.days];
    const idx = days.indexOf(day);
    if (idx > -1) days.splice(idx, 1); else days.push(day);
    days.sort();
    this.setData({ 'newTemplate.days': days });
  },
  onTemplateStartInput(e) { this.setData({ 'newTemplate.startTime': e.detail.value }); },
  onTemplateEndInput(e) { this.setData({ 'newTemplate.endTime': e.detail.value }); },
  onConfirmTemplate() {
    const { days, startTime, endTime } = this.data.newTemplate;
    if (days.length === 0) { wx.showToast({ title: '请选择星期', icon: 'none' }); return; }
    if (!startTime || !endTime) { wx.showToast({ title: '请填写时间', icon: 'none' }); return; }
    const template = { days: [...days].sort(), timeRanges: [{ start: startTime, end: endTime }] };
    const templates = [...this.data.templates, { ...template, daysText: days.map(d => ['','一','二','三','四','五','六','日'][d]).join('、') }];
    const slots = [...this.data.settings.available_slots, template];
    this.setData({ templates, 'settings.available_slots': slots, templateVisible: false });
  },
  onDeleteTemplate(e) {
    const idx = e.currentTarget.dataset.index;
    const templates = [...this.data.templates];
    const slots = [...this.data.settings.available_slots];
    templates.splice(idx, 1);
    slots.splice(idx, 1);
    this.setData({ templates, 'settings.available_slots': slots });
  },

  async onSave() {
    this.setData({ saving: true });
    try {
      await saveCoachSettings(this.data.settings);
      wx.showToast({ title: '设置已保存', icon: 'success' });
    } catch (e) { wx.showToast({ title: '保存失败', icon: 'none' }); }
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
          // 写入内存中的角色和学员信息
          const app = getApp();
          app.globalData.role = 'student';
          app.globalData.userInfo = {
            student_id: student._id,
            name: student.name,
            phone: student.phone || ''
          };

          wx.showToast({ title: '正在跳转学员端...', icon: 'none' });
          setTimeout(() => {
            wx.redirectTo({ url: '/pages/student/booking/booking' });
          }, 500);
        }
      }
    });
  }
});
