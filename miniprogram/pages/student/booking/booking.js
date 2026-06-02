// pages/student/booking/booking.js
const { formatDate, isPast } = require('../../../utils/date');
const {
  getLessons, createLesson, getCoachSettings, getStudentDetail,
  sendSubscribeMessage
} = require('../../../utils/api');

// 时间工具：HH:MM 转分钟数
function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 分钟数转 HH:MM
function minutesToTime(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// 获取某日期是星期几 (1=周一, 7=周日)
function getDayOfWeek(dateStr) {
  const d = new Date(dateStr);
  let day = d.getDay(); // 0=Sun
  return day === 0 ? 7 : day;
}

Page({
  data: {
    selectedDate: formatDate(new Date()),
    allLessons: [],
    myLessons: [],
    lessonDuration: 60,
    startTime: '08:00',
    endTime: '20:00',
    showTimeGrid: false,
    dayOff: false,
    isPastDate: false,
    occupiedSlots: [],
    _occupiedRanges: [],
    todayLessons: [],
    selectedTime: '',
    selectedStartTime: '',
    selectedEndTime: '',
    booking: false,
    remaining: 0,
    remainingLessonTip: '',
    studentId: '',
    coachOpenid: '',
    studentName: '',
    // 新增：教练不可约设置
    _blockedTimes: [],
    _dailyStartTime: '08:00',
    _dailyEndTime: '20:00'
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(0);
    }
    this.loadData();
  },

  async loadData() {
    try {
      const app = getApp();
      const userInfo = app.globalData.userInfo || {};
      const studentId = userInfo.student_id || '';

      // 优先从学员信息中获取教练 openid
      let coachOpenid = userInfo.coach_openid || '';

      // 如果有 student_id，从学员详情补充 coach_openid
      try {
        if (studentId) {
          const s = await getStudentDetail(studentId);
          coachOpenid = coachOpenid || s.coach_openid || '';
        }
      } catch (e) { /* ok */ }

      // 用教练 openid 查教练设置
      let settings = {};
      try {
        if (coachOpenid) {
          settings = await getCoachSettings(coachOpenid);
        }
      } catch (e) { /* ok */ }

      // 加载课程
      let lessons = [];
      try {
        lessons = await getLessons();
      } catch (e) { console.error('加载课程失败:', e); }

      // 剩余课时 + 学员姓名
      let remaining = 0;
      let studentName = userInfo.name || '';
      try {
        if (studentId) {
          const s = await getStudentDetail(studentId);
          remaining = s.remaining_lessons || 0;
          coachOpenid = coachOpenid || s.coach_openid || '';
          studentName = studentName || s.name || '';
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
        studentName,
        lessonDuration: settings.lesson_duration || 60,
        startTime: settings.daily_start_time || '08:00',
        endTime: settings.daily_end_time || '20:00',
        _blockedTimes: settings.blocked_times || [],
        _dailyStartTime: settings.daily_start_time || '08:00',
        _dailyEndTime: settings.daily_end_time || '20:00',
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
    const { selectedDate, allLessons, myLessons, _blockedTimes, _dailyStartTime, _dailyEndTime, lessonDuration } = this.data;
    const past = isPast(selectedDate);

    const todayLessons = (myLessons || []).filter(l => {
      const d = typeof l.date === 'string' ? l.date : formatDate(l.date);
      return d === selectedDate;
    }).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

    if (past) {
      this.setData({ dayOff: true, showTimeGrid: false, isPastDate: true, todayLessons });
      return;
    }

    // 检查是否有全天屏蔽
    const allDayBlock = (_blockedTimes || []).find(b =>
      b.type === 'date' && b.date === selectedDate && b.all_day
    );
    if (allDayBlock) {
      this.setData({ dayOff: true, showTimeGrid: false, isPastDate: false, todayLessons });
      return;
    }

    // 收集已有课程的占用区间
    const occupiedSlots = [];
    const occupiedRanges = [];
    (allLessons || [])
      .filter(l => {
        const d = typeof l.date === 'string' ? l.date : formatDate(l.date);
        return d === selectedDate && (l.status === 'pending' || l.status === 'confirmed');
      })
      .forEach(l => {
        occupiedSlots.push(l.start_time);
        if (l.start_time && l.end_time) {
          occupiedRanges.push({ start: l.start_time, end: l.end_time });
        }
      });

    // 收集教练不可约时段（循环规则 + 特定日期）
    const dayOfWeek = getDayOfWeek(selectedDate);
    const blockedRanges = [];
    (_blockedTimes || []).forEach(b => {
      if (b.type === 'recurring' && (b.days || []).includes(dayOfWeek)) {
        blockedRanges.push({ start: b.start_time, end: b.end_time });
      }
      if (b.type === 'date' && b.date === selectedDate && !b.all_day) {
        blockedRanges.push({ start: b.start_time, end: b.end_time });
      }
    });

    // 将不可约时段转为 occupiedSlots（按 lessonDuration 生成时间段）
    if (blockedRanges.length > 0) {
      const startMin = timeToMinutes(_dailyStartTime);
      const endMin = timeToMinutes(_dailyEndTime);
      for (let m = startMin; m + lessonDuration <= endMin; m += lessonDuration) {
        const slotStart = minutesToTime(m);
        const slotEnd = minutesToTime(m + lessonDuration);
        const blocked = blockedRanges.some(r => slotStart < r.end && slotEnd > r.start);
        if (blocked) occupiedSlots.push(slotStart);
      }
      // 去重
      const uniqueSlots = [...new Set(occupiedSlots)];
      this.setData({
        dayOff: false, isPastDate: false, showTimeGrid: true,
        occupiedSlots: uniqueSlots,
        _occupiedRanges: occupiedRanges,
        todayLessons
      });
    } else {
      this.setData({
        dayOff: false, isPastDate: false, showTimeGrid: true,
        occupiedSlots: occupiedSlots.map(s => s),
        _occupiedRanges: occupiedRanges,
        todayLessons
      });
    }
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
    const { selectedDate, selectedTime, selectedStartTime, selectedEndTime, studentId, coachOpenid, remaining } = this.data;

    // --- 前置校验 ---
    if (!selectedTime) {
      wx.showToast({ title: '请选择时间', icon: 'none' }); return;
    }
    if (!studentId) {
      wx.showToast({ title: '未绑定学员信息', icon: 'none' }); return;
    }
    if (!coachOpenid) {
      wx.showToast({ title: '未找到教练信息', icon: 'none' }); return;
    }
    // 课时不足拦截
    if (remaining <= 0) {
      wx.showModal({
        title: '课时不足',
        content: '你的剩余课时为 0，无法约课。请联系教练充值课时。',
        showCancel: false
      });
      return;
    }

    // --- 时间冲突检测 ---
    const newStart = selectedStartTime || selectedTime.split('-')[0];
    const newEnd = selectedEndTime || selectedTime.split('-')[1];
    const ranges = this.data._occupiedRanges || [];
    const conflict = ranges.some(r => newStart < r.end && newEnd > r.start);
    if (conflict) {
      wx.showToast({ title: '该时段已被预约，请重新选择', icon: 'none' });
      return;
    }

    // --- 请求订阅消息授权 ---
    // 在关键操作前引导用户授权订阅消息，不阻塞主流程
    this._requestSubscribe();

    const [s, e] = selectedTime.split('-');

    // 确认提交
    const confirmRes = await new Promise(r => {
      wx.showModal({
        title: '确认约课',
        content: `确认预约 ${selectedDate} ${s}-${e} 的课程？`,
        success: r
      });
    });
    if (!confirmRes.confirm) return;

    this.setData({ booking: true });

    try {
      const app = getApp();
      await createLesson({
        student_id: studentId,
        student_name: this.data.studentName || (app.globalData.userInfo && app.globalData.userInfo.name) || '学员',
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

      // 异步通知教练
      this._notifyCoach(coachOpenid, selectedDate, s, e);

      this.loadData();
    } catch (err) {
      console.error('约课失败:', err);
      wx.showToast({ title: '约课失败，请重试', icon: 'none' });
    }
    this.setData({ booking: false });
  },

  /**
   * 请求订阅消息授权
   * 微信规定必须由用户点击行为触发，此处放在约课提交流程中
   */
  _requestSubscribe() {
    // 模板 ID 需替换为实际申请的模板 ID
    const tmplIds = [];
    // 如果模板 ID 未配置（占位符），跳过请求避免报错
    if (tmplIds.length === 0) return;

    wx.requestSubscribeMessage({
      tmplIds: tmplIds,
      success: (res) => {
        // 记录授权结果，各模板 'accept' | 'reject' | 'ban'
        console.log('订阅消息授权结果:', res);
      },
      fail: (err) => {
        console.warn('订阅消息授权失败:', err);
      }
    });
  },

  /**
   * 通知教练有新的约课请求
   */
  async _notifyCoach(coachOpenid, date, startTime, endTime) {
    try {
      await sendSubscribeMessage({
        scene: 'booking_notify',
        toOpenid: coachOpenid,
        data: {
          thing1: this.data.studentName || '学员',
          thing2: '发起约课请求',
          time3: `${startTime}-${endTime}`,
          date4: date,
          phrase5: '待确认'
        }
      });
    } catch (e) {
      console.warn('通知教练失败:', e);
    }
  }
});
