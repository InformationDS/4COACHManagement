// pages/coach/student-detail/student-detail.js
const {
  getStudentDetail,
  addStudent,
  updateStudent,
  getLessonCardLogs,
  adjustLessonBalance,
  uploadImage,
  getStudentLessons
} = require('../../../utils/api');
const { formatDateTime } = require('../../../utils/date');

Page({
  data: {
    isEdit: false,
    studentId: '',
    loading: false,
    saving: false,
    form: {
      avatar_url: '',
      name: '',
      phone: '',
      gender: '',
      age: '',
      wechat: '',
      location_preference: '',
      notes: ''
    },
    student: {},
    lessonLogs: [],
    recentLessons: [],
    displayLessons: [],
    showAllLessons: false,
    showLessonCardDetail: false,
    rechargeVisible: false,
    rechargeAmount: '',
    rechargeReason: '',
    recharging: false,
    rechargeMode: 'recharge'
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ isEdit: true, studentId: options.id });
      this.loadData(options.id);
    } else {
      this.setData({ loading: false });
    }
  },

  async loadData(id) {
    this.setData({ loading: true });
    try {
      const [student, logs, lessons] = await Promise.all([
        getStudentDetail(id),
        getLessonCardLogs(id),
        getStudentLessons(id, 50)
      ]);

      const fmtDate = (d) => {
        if (!d) return '';
        const s = typeof d === 'string' ? d : d.toString();
        return s.length === 10 ? s.slice(5) : s.slice(0, 10);
      };
      const recentLessons = lessons.map(l => ({ ...l, _dateShort: fmtDate(l.date) }));

      this.setData({
        student,
        form: {
          avatar_url: student.avatar_url || '',
          name: student.name || '',
          phone: student.phone || '',
          gender: student.gender || '',
          age: student.age ? String(student.age) : '',
          wechat: student.wechat || '',
          location_preference: student.location_preference || '',
          notes: student.notes || ''
        },
        lessonLogs: logs.map(log => ({
          ...log,
          timeText: log.created_at ? formatDateTime(log.created_at) : ''
        })),
        recentLessons,
        displayLessons: recentLessons.slice(0, 5),
        showAllLessons: false,
        loading: false
      });
    } catch (err) {
      console.error('加载学员数据失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onChooseAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const filePath = res.tempFilePaths[0];
        wx.showLoading({ title: '上传中...' });
        try {
          const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
          const fileID = await uploadImage(filePath, cloudPath);
          this.setData({ 'form.avatar_url': fileID });
          wx.hideLoading();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '头像上传失败', icon: 'none' });
        }
      }
    });
  },

  onFieldChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [`form.${field}`]: value });
  },

  onGenderTap(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ 'form.gender': value === this.data.form.gender ? '' : value });
  },

  async onSave() {
    const { form, isEdit, studentId } = this.data;

    if (!form.name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    if (!form.phone.trim()) {
      wx.showToast({ title: '请输入手机号', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      const data = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        gender: form.gender,
        age: form.age ? parseInt(form.age) : null,
        wechat: form.wechat.trim(),
        location_preference: form.location_preference.trim(),
        notes: form.notes.trim(),
        avatar_url: form.avatar_url
      };

      if (isEdit) {
        await updateStudent(studentId, data);
        wx.showToast({ title: '保存成功', icon: 'success' });
      } else {
        await addStudent(data);
        wx.showToast({ title: '学员添加成功', icon: 'success' });
      }

      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      console.error('保存失败:', err);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  onRecharge() {
    this.setData({
      rechargeVisible: true,
      rechargeMode: 'recharge',
      rechargeAmount: '',
      rechargeReason: ''
    });
  },

  onDeduct() {
    this.setData({
      rechargeVisible: true,
      rechargeMode: 'deduct',
      rechargeAmount: '',
      rechargeReason: ''
    });
  },

  onCloseRecharge() {
    this.setData({ rechargeVisible: false });
  },

  onScheduleLesson() {
    const { studentId, student } = this.data;
    if (!studentId) return;
    getApp().globalData.pendingSchedule = {
      studentId,
      studentName: student.name || ''
    };
    wx.switchTab({ url: '/pages/coach/lessons/lessons' });
  },

  onAskAiStudent() {
    const { studentId, student } = this.data;
    if (!studentId) return;
    getApp().globalData.pendingAiRequest = {
      text: `分析一下${student.name || '这个学员'}最近的训练情况`,
      sourceContext: {
        source: 'student_detail',
        intent: 'analyze_student',
        student_id: studentId
      }
    };
    wx.switchTab({ url: '/pages/coach/ai-assistant/ai-assistant' });
  },

  onAskAiNextPlan() {
    const { studentId, student } = this.data;
    if (!studentId) return;
    getApp().globalData.pendingAiRequest = {
      text: `给${student.name || '这个学员'}生成下次课建议`,
      sourceContext: {
        source: 'student_detail',
        intent: 'analyze_student',
        student_id: studentId,
        request_type: 'next_plan'
      }
    };
    wx.switchTab({ url: '/pages/coach/ai-assistant/ai-assistant' });
  },

  noop() {},

  onRechargeInput(e) {
    this.setData({ rechargeAmount: e.detail.value });
  },

  onRechargeReasonInput(e) {
    this.setData({ rechargeReason: e.detail.value });
  },

  async onConfirmRecharge() {
    const { rechargeAmount, rechargeReason, rechargeMode, studentId } = this.data;
    const amount = parseInt(rechargeAmount);

    if (isNaN(amount) || amount <= 0) {
      wx.showToast({ title: '请输入有效的课时数', icon: 'none' });
      return;
    }

    const changeAmount = rechargeMode === 'deduct' ? -amount : amount;
    const reason = rechargeReason || (rechargeMode === 'deduct' ? '手动扣减' : '课时充值');

    this.setData({ recharging: true });
    try {
      const res = await adjustLessonBalance(studentId, changeAmount, reason);
      if (!res || !res.success) {
        wx.showToast({ title: (res && res.message) || '操作失败', icon: 'none' });
        return;
      }

      wx.showToast({ title: rechargeMode === 'deduct' ? '扣减成功' : '充值成功', icon: 'success' });
      this.setData({ rechargeVisible: false, recharging: false });
      this.loadData(studentId);
    } catch (err) {
      console.error('课时操作失败:', err);
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    } finally {
      this.setData({ recharging: false });
    }
  },

  onToggleAllLessons() {
    const showAll = !this.data.showAllLessons;
    this.setData({
      showAllLessons: showAll,
      displayLessons: showAll ? this.data.recentLessons : this.data.recentLessons.slice(0, 5)
    });
  },

  onLessonTap(e) {
    const { id, status } = e.currentTarget.dataset;
    if (status === 'completed') {
      wx.navigateTo({ url: `/pages/coach/training-record/training-record?lesson_id=${id}` });
    }
  },

  onShowLessonCardDetail() {
    this.setData({ showLessonCardDetail: true });
  },

  onCloseLessonCardDetail() {
    this.setData({ showLessonCardDetail: false });
  }
});
