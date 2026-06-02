// pages/coach/lessons/lessons.js
const { formatDate } = require('../../../utils/date');
const { getLessons, createLesson, updateLesson, getStudents, getCoachSettings, addLessonCardLog, updateStudent } = require('../../../utils/api');

Page({
  data: {
    selectedDate: formatDate(new Date()),
    lessons: [],
    todayLessons: [],
    students: [],
    studentNames: [],
    studentIdx: 0,
    lessonDuration: 60,
    locations: [],
    locationIdx: 0,
    occupiedSlots: [],

    // 排课弹窗
    showCreateModal: false,
    selectedTime: '',
    selectedStartTime: '',
    selectedEndTime: '',
    creating: false,

    // 详情弹窗
    showDetailModal: false,
    detailLesson: {}
  },

  async onShow() {
    await this.loadData();
  },

  async loadData() {
    try {
      const [lessons, students, settings] = await Promise.all([
        getLessons(),
        getStudents(),
        getCoachSettings()
      ]);

      const studentNames = students.map(s => s.name);

      this.setData({
        lessons,
        todayLessons: this._filterTodayLessons(lessons, this.data.selectedDate),
        students,
        studentNames,
        lessonDuration: settings ? settings.lesson_duration || 60 : 60,
        locations: settings ? settings.common_locations || [] : [],
        occupiedSlots: this._getOccupiedSlots(lessons, formatDate(new Date()))
      });
    } catch (e) {
      console.error('加载课程数据失败:', e);
    }
  },

  _filterTodayLessons(lessons, date) {
    return lessons
      .filter(l => (typeof l.date === 'string' ? l.date : formatDate(l.date)) === date)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  },

  _getOccupiedSlots(lessons, date) {
    return lessons
      .filter(l => {
        const d = typeof l.date === 'string' ? l.date : formatDate(l.date);
        return d === date && (l.status === 'pending' || l.status === 'confirmed');
      })
      .map(l => l.start_time);
  },

  onCalendarChange(e) {
    const date = e.detail.value;
    this.setData({
      selectedDate: date,
      todayLessons: this._filterTodayLessons(this.data.lessons, date)
    });
  },

  // ===== 排课 =====
  onCreateLesson() {
    const todaySlots = this.data.lessons
      .filter(l => {
        const d = typeof l.date === 'string' ? l.date : formatDate(l.date);
        return d === this.data.selectedDate && (l.status === 'pending' || l.status === 'confirmed');
      })
      .map(l => l.start_time);

    this.setData({
      showCreateModal: true,
      occupiedSlots: todaySlots,
      selectedTime: '',
      selectedStartTime: '',
      selectedEndTime: '',
      locationIdx: 0
    });
  },

  onCloseCreate() { this.setData({ showCreateModal: false }); },

  onStudentPickerChange(e) {
    this.setData({ studentIdx: parseInt(e.detail.value) });
  },

  onLocationPickerChange(e) {
    this.setData({ locationIdx: parseInt(e.detail.value) });
  },

  onTimeChange(e) {
    const { value, startTime, endTime, count } = e.detail;
    this.setData({
      selectedTime: value,
      selectedStartTime: startTime,
      selectedEndTime: endTime
    });
  },

  async onConfirmCreate() {
    const { studentIdx, students, selectedDate, selectedStartTime, selectedEndTime, selectedTime, locations, locationIdx } = this.data;

    if (studentIdx < 0 || !students[studentIdx]) {
      wx.showToast({ title: '请选择学员', icon: 'none' }); return;
    }
    if (!selectedTime) {
      wx.showToast({ title: '请选择时间', icon: 'none' }); return;
    }

    const student = students[studentIdx];

    this.setData({ creating: true });

    try {
      // 支持连排：为每节课创建一个 lesson 记录
      const timeSlots = selectedTime.split(',');
      // 解析 start-end 范围
      const startEnd = selectedTime;
      const [s, e] = startEnd.split('-');

      await createLesson({
        student_id: student._id,
        student_name: student.name,
        coach_openid: getApp().globalData.openid,
        date: selectedDate,
        start_time: s,
        end_time: e,
        location: locations[locationIdx] || '',
        status: 'pending',
        initiated_by: 'coach'
      });

      wx.showToast({ title: '排课成功', icon: 'success' });
      this.setData({ showCreateModal: false });
      this.loadData();
    } catch (err) {
      console.error('排课失败:', err);
      wx.showToast({ title: '排课失败', icon: 'none' });
    }
    this.setData({ creating: false });
  },

  // ===== 课程详情 & 操作 =====
  onLessonTap(e) {
    this.setData({ showDetailModal: true, detailLesson: e.detail.lesson });
  },

  onCloseDetail() { this.setData({ showDetailModal: false }); },

  async onConfirmLesson() {
    await this._changeLessonStatus('confirmed');
  },

  async onCancelLesson() {
    wx.showModal({
      title: '取消课程',
      content: '确定要取消这节课吗？',
      success: async (res) => {
        if (res.confirm) await this._changeLessonStatus('cancelled', false);
      }
    });
  },

  async onCompleteLesson() {
    wx.showModal({
      title: '完成课程',
      content: '确认课程已完成？将自动扣减 1 课时。',
      success: async (res) => {
        if (res.confirm) await this._changeLessonStatus('completed', true);
      }
    });
  },

  async _changeLessonStatus(status, deduct = false) {
    try {
      await updateLesson(this.data.detailLesson._id, { status });

      if (deduct) {
        const student = await this._getStudent(this.data.detailLesson.student_id);
        if (student) {
          const newBalance = Math.max(0, (student.remaining_lessons || 0) - 1);
          await updateStudent(student._id, { remaining_lessons: newBalance });
          await addLessonCardLog({
            student_id: student._id,
            change_amount: -1,
            balance_after: newBalance,
            reason: '课程完成自动扣减',
            related_lesson_id: this.data.detailLesson._id
          });
        }
      }

      const labels = { confirmed: '已确认', cancelled: '已取消', completed: '已完成' };
      wx.showToast({ title: labels[status] || '', icon: 'success' });
      this.setData({ showDetailModal: false });
      this.loadData();
    } catch (e) {
      console.error('操作失败:', e);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  async _getStudent(id) {
    const { getStudentDetail } = require('../../../utils/api');
    try { return await getStudentDetail(id); } catch (e) { return null; }
  }
});
