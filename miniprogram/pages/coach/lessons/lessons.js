// pages/coach/lessons/lessons.js
const { formatDate, isPast } = require('../../../utils/date');
const {
  getLessons, createLesson, updateLesson, getStudents, getCoachSettings,
  addLessonCardLog, updateStudent, getStudentDetail,
  sendSubscribeMessage, getStudentOpenid
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
    locations: [],
    locationIdx: 0,
    occupiedSlots: [],       // 已占时段字符串列表（给time-grid）
    _occupiedRanges: [],     // 已占时间区间列表（冲突检测）
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
        students,
        studentNames,
        lessonDuration: settings ? settings.lesson_duration || 60 : 60,
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

    return { todayLessons, occupiedSlots, occupiedRanges };
  },

  onCalendarChange(e) {
    const date = e.detail.value;
    const info = this._buildTodayInfo(this.data.lessons, date);
    this.setData({
      selectedDate: date,
      todayLessons: info.todayLessons,
      occupiedSlots: info.occupiedSlots,
      _occupiedRanges: info.occupiedRanges
    });
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
      const newLesson = await createLesson({
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

      // 发送通知给学员（异步，不阻塞）
      this._notifyStudent(student._id, 'booking_notify', {
        studentName: student.name,
        date: selectedDate,
        time: `${s}-${e}`,
        location: locations[locationIdx] || '待定'
      });

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

    // 通知学员：教练已确认
    if (lesson.student_id) {
      this._notifyStudent(lesson.student_id, 'confirm_notify', {
        studentName: lesson.student_name || '学员',
        date: typeof lesson.date === 'string' ? lesson.date : formatDate(lesson.date),
        time: `${lesson.start_time}-${lesson.end_time}`,
        location: lesson.location || '待定'
      });
    }
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
    await this._changeLessonStatus(lessonId, 'cancelled', false, reason);

    // 通知学员：课程已取消
    const lesson = this.data.detailLesson;
    if (lesson.student_id) {
      this._notifyStudent(lesson.student_id, 'cancel_notify', {
        studentName: lesson.student_name || '学员',
        date: typeof lesson.date === 'string' ? lesson.date : formatDate(lesson.date),
        time: `${lesson.start_time}-${lesson.end_time}`,
        reason: reason
      });
    }
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
        if (res.confirm) self._changeLessonStatus(lessonId, 'completed', true);
      }
    });
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
   * @param {boolean} deduct     - 是否扣减课时
   * @param {string} cancelReason - 取消原因（status=cancelled 时）
   */
  async _changeLessonStatus(lessonId, status, deduct = false, cancelReason = '') {
    try {
      const updateData = { status };
      if (status === 'cancelled') {
        updateData.cancel_by = 'coach';
        if (cancelReason) updateData.cancel_reason = cancelReason;
      }

      await updateLesson(lessonId, updateData);
      console.log('课程状态已更新:', lessonId, '→', status);

      // 扣减课时（标记完成时）
      if (deduct) {
        const detailLesson = this.data.detailLesson;
        const studentId = detailLesson.student_id;
        if (!studentId) {
          console.warn('课程缺少 student_id，无法扣减课时');
        } else {
          const student = await getStudentDetail(studentId).catch(() => null);
          if (student) {
            const newBalance = Math.max(0, (student.remaining_lessons || 0) - 1);
            await updateStudent(studentId, { remaining_lessons: newBalance });
            await addLessonCardLog({
              student_id: studentId,
              change_amount: -1,
              balance_after: newBalance,
              reason: '课程完成自动扣减',
              related_lesson_id: lessonId
            });
            console.log(`课时已扣减: ${student.name} ${student.remaining_lessons}→${newBalance}`);
          }
        }
      }

      const labels = { confirmed: '已确认', cancelled: '已取消', completed: '已完成' };
      wx.showToast({ title: labels[status], icon: 'success' });

      this.setData({ showDetailModal: false, showCancelModal: false });
      this.loadData();
    } catch (e) {
      console.error('课程操作失败:', lessonId, status, deduct, e);
      wx.showToast({ title: '操作失败: ' + (e.message || '未知错误'), icon: 'none' });
    }
  },

  /**
   * 向学员发送订阅消息（异步，不阻塞主流程）
   * @param {string} studentId - 学员 _id
   * @param {string} scene     - 通知场景
   * @param {object} info      - 课程信息
   */
  async _notifyStudent(studentId, scene, info) {
    try {
      const studentOpenid = await getStudentOpenid(studentId);
      if (!studentOpenid) {
        console.warn('学员未绑定 openid，无法发送通知');
        return;
      }
      // 请求订阅消息授权提示（由页面触发，这里仅发送）
      await sendSubscribeMessage({
        scene,
        toOpenid: studentOpenid,
        data: {
          thing1: info.studentName || '学员',
          thing2: scene === 'cancel_notify' ? (info.reason || '课程已取消') : (info.location || '已确认'),
          time3: info.time || '',
          date4: info.date || '',
          phrase5: scene === 'confirm_notify' ? '已确认' : scene === 'cancel_notify' ? '已取消' : '待确认',
          page: ''
        }
      });
    } catch (e) {
      console.warn('通知学员失败:', e);
    }
  }
});
