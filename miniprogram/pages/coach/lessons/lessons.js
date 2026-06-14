// pages/coach/lessons/lessons.js
const { formatDate } = require('../../../utils/date');
const {
  getLessons, createLesson, updateLesson, getStudents, getCoachSettings,
  completeLesson
} = require('../../../utils/api');

Page({
  data: {
    selectedDate: formatDate(new Date()),
    lessons: [],
    todayLessons: [],
    students: [],
    studentNames: [],
    studentIdx: 0,
    lessonDuration: 60,
    startTime: '08:00',
    endTime: '20:00',
    locations: [],
    locationIdx: 0,
    occupiedSlots: [],       // 已占时段字符串列表（给time-grid）
    _occupiedRanges: [],     // 已占时间区间列表（冲突检测）
    daySummary: {
      total: 0,
      pending: 0,
      confirmed: 0,
      completed: 0,
      nextStudent: '',
      nextTime: '',
      nextLocation: ''
    },
    showCreateModal: false,
    selectedTime: '',
    selectedStartTime: '',
    selectedEndTime: '',
    creating: false,
    showDetailModal: false,
    detailLesson: {},
    // 取消弹窗
    showCancelModal: false,
    cancelReason: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(0);
    }
    this.setData({
      showCreateModal: false,
      showDetailModal: false,
      showCancelModal: false
    });
    this.loadData();
  },

  async loadData() {
    try {
      const [lessons, students, settings] = await Promise.all([
        getLessons(),
        getStudents(),
        getCoachSettings()
      ]);
      const studentNames = students.map(s => s.name);
      const todayInfo = this._buildTodayInfo(lessons, this.data.selectedDate);
      this.setData({
        lessons,
        todayLessons: todayInfo.todayLessons,
        daySummary: todayInfo.daySummary,
        students,
        studentNames,
        lessonDuration: settings ? settings.lesson_duration || 60 : 60,
        startTime: settings ? settings.daily_start_time || '08:00' : '08:00',
        endTime: settings ? settings.daily_end_time || '20:00' : '20:00',
        locations: settings ? settings.common_locations || [] : [],
        occupiedSlots: todayInfo.occupiedSlots,
        _occupiedRanges: todayInfo.occupiedRanges
      });
    } catch (e) {
      console.error('加载课程数据失败:', e);
    }
  },

  _buildTodayInfo(lessons, date) {
    const activeLessons = lessons.filter(l => {
      const d = typeof l.date === 'string' ? l.date : formatDate(l.date);
      return d === date && (l.status === 'pending' || l.status === 'confirmed');
    });
    const occupiedSlots = [];
    const occupiedRanges = [];
    activeLessons.forEach(l => {
      occupiedSlots.push(l.start_time);
      if (l.start_time && l.end_time) {
        occupiedRanges.push({ start: l.start_time, end: l.end_time });
      }
    });
    const todayLessons = lessons
      .filter(l => (typeof l.date === 'string' ? l.date : formatDate(l.date)) === date)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const currentDate = formatDate(new Date());
    const now = new Date();
    const nowText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const nextLesson = activeLessons
      .filter(l => date !== currentDate || !l.end_time || l.end_time >= nowText)
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0] || activeLessons[0] || null;

    const daySummary = {
      total: todayLessons.length,
      pending: todayLessons.filter(l => l.status === 'pending').length,
      confirmed: todayLessons.filter(l => l.status === 'confirmed').length,
      completed: todayLessons.filter(l => l.status === 'completed').length,
      nextStudent: nextLesson ? (nextLesson.student_name || '学员') : '',
      nextTime: nextLesson ? `${nextLesson.start_time}-${nextLesson.end_time}` : '',
      nextLocation: nextLesson ? (nextLesson.location || '未指定地点') : ''
    };

    return { todayLessons, occupiedSlots, occupiedRanges, daySummary };
  },

  onCalendarChange(e) {
    const date = e.detail.value;
    const info = this._buildTodayInfo(this.data.lessons, date);
    this.setData({
      selectedDate: date,
      todayLessons: info.todayLessons,
      daySummary: info.daySummary,
      occupiedSlots: info.occupiedSlots,
      _occupiedRanges: info.occupiedRanges
    });
  },

  onQuickAddStudent() {
    wx.navigateTo({ url: '/pages/coach/student-detail/student-detail' });
  },

  // ===== 排课 =====
  onCreateLesson() {
    const info = this._buildTodayInfo(this.data.lessons, this.data.selectedDate);
    this.setData({
      showCreateModal: true,
      occupiedSlots: info.occupiedSlots,
      _occupiedRanges: info.occupiedRanges,
      selectedTime: '',
      selectedStartTime: '',
      selectedEndTime: '',
      locationIdx: 0
    });
  },

  onCloseCreate() { this.setData({ showCreateModal: false }); },

  onStudentPickerChange(e) { this.setData({ studentIdx: parseInt(e.detail.value) }); },
  onLocationPickerChange(e) { this.setData({ locationIdx: parseInt(e.detail.value) }); },

  onTimeChange(e) {
    const { value, startTime, endTime } = e.detail;
    this.setData({ selectedTime: value, selectedStartTime: startTime, selectedEndTime: endTime });
  },

  async onConfirmCreate() {
    const { studentIdx, students, selectedDate, selectedTime, selectedStartTime, selectedEndTime, locations, locationIdx, _occupiedRanges } = this.data;
    if (studentIdx < 0 || !students[studentIdx]) {
      wx.showToast({ title: '请选择学员', icon: 'none' }); return;
    }
    if (!selectedTime) {
      wx.showToast({ title: '请选择时间', icon: 'none' }); return;
    }

    // === 时间冲突检测（区间重叠） ===
    const newStart = selectedStartTime || selectedTime.split('-')[0];
    const newEnd = selectedEndTime || selectedTime.split('-')[1];
    const conflict = (_occupiedRanges || []).some(r => newStart < r.end && newEnd > r.start);
    if (conflict) {
      wx.showToast({ title: '该时段与已有课程冲突', icon: 'none' });
      return;
    }

    const student = students[studentIdx];
    this.setData({ creating: true });
    try {
      const [s, e] = selectedTime.split('-');
      await createLesson({
        student_id: student._id,
        student_name: student.name,
        coach_openid: getApp().globalData.openid,
        date: selectedDate,
        start_time: s,
        end_time: e,
        location: locations[locationIdx] || '',
        status: 'confirmed',
        initiated_by: 'coach'
      });

      wx.showToast({ title: '已加入日程', icon: 'success' });
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
    const lesson = e.detail && e.detail.lesson;
    if (!lesson || !lesson._id) {
      console.error('onLessonTap: 无效的课程数据', e);
      return;
    }
    this.setData({ showDetailModal: true, detailLesson: lesson });
  },

  onCloseDetail() { this.setData({ showDetailModal: false }); },
  onDetailVisibleChange(e) {
    if (!e.detail.visible) {
      this.setData({ showDetailModal: false });
    }
  },

  // 确认课程
  async onConfirmLesson() {
    const lesson = this.data.detailLesson;
    await this._changeLessonStatus(lesson._id, 'confirmed');
  },

  // 取消课程（打开原因输入弹窗）
  onCancelLesson() {
    this.setData({ showCancelModal: true, cancelReason: '' });
  },

  // 确认取消
  async onConfirmCancel() {
    const lessonId = this.data.detailLesson._id;
    const reason = this.data.cancelReason.trim() || '教练取消';
    this.setData({ showCancelModal: false });
    await this._changeLessonStatus(lessonId, 'cancelled', reason);
  },

  // 关闭取消弹窗
  onCloseCancelModal() { this.setData({ showCancelModal: false }); },

  // 取消原因输入
  onCancelReasonInput(e) { this.setData({ cancelReason: e.detail.value }); },

  // 完成课程
  onCompleteLesson() {
    const self = this;
    const lessonId = this.data.detailLesson._id;
    wx.showModal({
      title: '完成课程',
      content: '确认课程已完成？将自动扣减 1 课时。',
      success(res) {
        if (res.confirm) self._completeLesson(lessonId);
      }
    });
  },

  async _completeLesson(lessonId) {
    try {
      const res = await completeLesson(lessonId);
      if (!res || !res.success) {
        wx.showToast({ title: (res && res.message) || '操作失败', icon: 'none' });
        return;
      }

      wx.showToast({ title: res.skipped ? '已完成' : '已完成并扣课时', icon: 'success' });
      this.setData({ showDetailModal: false, showCancelModal: false });
      this.loadData();
    } catch (e) {
      console.error('完成课程失败:', e);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 跳转训练记录页面
  onTrainingRecord() {
    const lessonId = this.data.detailLesson._id;
    this.setData({ showDetailModal: false });
    wx.navigateTo({
      url: `/pages/coach/training-record/training-record?lesson_id=${lessonId}`
    });
  },

  /**
   * 课程状态变更核心方法
   * @param {string} lessonId    - 课程 ID
   * @param {string} status      - 目标状态
   * @param {string} cancelReason - 取消原因（status=cancelled 时）
   */
  async _changeLessonStatus(lessonId, status, cancelReason = '') {
    try {
      const updateData = { status };
      if (status === 'cancelled') {
        updateData.cancel_by = 'coach';
        if (cancelReason) updateData.cancel_reason = cancelReason;
      }

      await updateLesson(lessonId, updateData);
      console.log('课程状态已更新:', lessonId, '→', status);

      const labels = { confirmed: '已确认', cancelled: '已取消' };
      wx.showToast({ title: labels[status], icon: 'success' });

      this.setData({ showDetailModal: false, showCancelModal: false });
      this.loadData();
    } catch (e) {
      console.error('课程操作失败:', lessonId, status, e);
      wx.showToast({ title: '操作失败: ' + (e.message || '未知错误'), icon: 'none' });
    }
  }
});
