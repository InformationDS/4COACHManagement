// pages/student/booking/booking.js
const { formatDate, isPast } = require('../../../utils/date');
const { getLessons, createLesson, getCoachSettings, getStudentDetail } = require('../../../utils/api');

Page({
  data: {
    selectedDate: formatDate(new Date()),
    allLessons: [],       // 所有课程（传给日历）
    myLessons: [],        // 我自己当日的课程
    lessonDuration: 60,
    startTime: '08:00',
    endTime: '18:00',
    showTimeGrid: false,
    dayOff: false,
    isPastDate: false,
    occupiedSlots: [],    // 今日已占用的时段
    todayLessons: [],     // 今日我的课程列表
    selectedTime: '',
    selectedStartTime: '',
    selectedEndTime: '',
    booking: false,
    remaining: 0,
    remainingLessonTip: '',
    studentId: '',
    coachOpenid: ''       // 教练 openid
  },

  onShow() {
    // 页面显示时可能角色已切，重新加载
    this.loadData();
  },

  async loadData() {
    try {
      const app = getApp();
      const userInfo = app.globalData.userInfo || {};
      const studentId = userInfo.student_id || '';

      // 并行加载
      let lessons = [];
      let settings = {};
      let remaining = 0;
      let coachOpenid = '';

      try {
        lessons = await getLessons();
      } catch (e) { console.error('加载课程失败:', e); }

      try {
        settings = await getCoachSettings();
        coachOpenid = settings.openid || '';
      } catch (e) { /* ok */ }

      try {
        if (studentId) {
          const s = await getStudentDetail(studentId);
          remaining = s.remaining_lessons || 0;
          coachOpenid = coachOpenid || s.coach_openid || '';
        }
      } catch (e) { /* ok */ }

      // 筛选我的课程
      const myLessons = (lessons || []).filter(l => l.student_id === studentId);

      this.setData({
        allLessons: lessons,
        myLessons,
        todayLessons: myLessons.filter(l => {
          const d = typeof l.date === 'string' ? l.date : formatDate(l.date);
          return d === this.data.selectedDate;
        }).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')),
        studentId,
        coachOpenid,
        lessonDuration: settings.lesson_duration || 60,
        remaining,
        remainingLessonTip: remaining <= 0 ? '课时不足，无法约课' : remaining <= 2 ? `剩余仅 ${remaining} 课时` : ''
      });

      this._updateDayAvailability();
    } catch (e) {
      console.error('加载约课数据失败:', e);
    }
  },

  onCalendarChange(e) {
    const date = e.detail.value;
    this.setData({ selectedDate: date, selectedTime: '', selectedStartTime: '', selectedEndTime: '' });
    this._updateDayAvailability();
  },

  _updateDayAvailability() {
    const { selectedDate, allLessons, myLessons } = this.data;
    const past = isPast(selectedDate);

    // 筛选当日我的课程
    const todayLessons = (myLessons || []).filter(l => {
      const d = typeof l.date === 'string' ? l.date : formatDate(l.date);
      return d === selectedDate;
    }).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

    if (past) {
      this.setData({ dayOff: true, showTimeGrid: false, isPastDate: true, todayLessons });
      return;
    }

    // 该日已占时段（所有课程，不只自己的）
    const occupied = (allLessons || [])
      .filter(l => {
        const d = typeof l.date === 'string' ? l.date : formatDate(l.date);
        return d === selectedDate && (l.status === 'pending' || l.status === 'confirmed');
      })
      .map(l => l.start_time);

    this.setData({
      dayOff: false,
      isPastDate: false,
      showTimeGrid: true,
      occupiedSlots: occupied,
      todayLessons
    });
  },

  onTimeChange(e) {
    const { value, startTime, endTime } = e.detail;
    this.setData({ selectedTime: value, selectedStartTime: startTime, selectedEndTime: endTime });
  },

  onLessonTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/student/lesson-detail/lesson-detail?id=${id}` });
  },

  async onSubmit() {
    const { selectedDate, selectedTime, studentId, coachOpenid } = this.data;

    if (!selectedTime) {
      wx.showToast({ title: '请选择时间', icon: 'none' }); return;
    }
    if (!studentId) {
      wx.showToast({ title: '未绑定学员信息', icon: 'none' }); return;
    }
    if (!coachOpenid) {
      wx.showToast({ title: '未找到教练信息', icon: 'none' }); return;
    }

    this.setData({ booking: true });

    try {
      const app = getApp();
      const [s, e] = selectedTime.split('-');

      await createLesson({
        student_id: studentId,
        student_name: (app.globalData.userInfo && app.globalData.userInfo.name) || '学员',
        coach_openid: coachOpenid,
        date: selectedDate,
        start_time: s,
        end_time: e,
        location: '',
        status: 'pending',
        initiated_by: 'student'
      });

      wx.showToast({ title: '约课成功，等待教练确认', icon: 'success' });
      this.setData({ selectedTime: '', selectedStartTime: '', selectedEndTime: '' });
      this.loadData();
    } catch (err) {
      console.error('约课失败:', err);
      wx.showToast({ title: '约课失败，请重试', icon: 'none' });
    }
    this.setData({ booking: false });
  }
});
