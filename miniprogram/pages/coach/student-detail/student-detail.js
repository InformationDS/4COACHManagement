// pages/coach/student-detail/student-detail.js
const {
  getStudentDetail, addStudent, updateStudent, getLessonCardLogs,
  addLessonCardLog, uploadImage, getStudentLessons
} = require('../../../utils/api');
const { formatDateTime } = require('../../../utils/date');

Page({
  data: {
    isEdit: false,         // 是否为编辑模式
    studentId: '',         // 学员 _id（编辑模式）
    loading: false,
    saving: false,

    // 表单数据
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

    // 学员原始数据（编辑模式）
    student: {},

    // 课时变动记录
    lessonLogs: [],

    // 课程历史
    recentLessons: [],     // 所有课程
    displayLessons: [],    // 展示用（前5条或全部）
    showAllLessons: false, // 是否展开全部课程

    // 课时卡详情弹窗
    showLessonCardDetail: false,

    // 充值弹窗
    rechargeVisible: false,
    rechargeAmount: '',
    rechargeReason: '',
    recharging: false,
    rechargeMode: 'recharge' // 'recharge' | 'deduct'
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ isEdit: true, studentId: options.id });
      this.loadData(options.id);
    } else {
      this.setData({ loading: false });
    }
  },

  /**
   * 加载已有学员数据
   */
  async loadData(id) {
    this.setData({ loading: true });
    try {
      const [student, logs, lessons] = await Promise.all([
        getStudentDetail(id),
        getLessonCardLogs(id),
        getStudentLessons(id, 50)
      ]);

      // DEBUG: 诊断近期课程为空问题
      console.log('[DEBUG] studentId传入:', id);
      console.log('[DEBUG] student._id:', student._id);
      console.log('[DEBUG] lessons返回条数:', lessons.length);
      if (lessons.length > 0) {
        console.log('[DEBUG] 首条lesson.student_id:', lessons[0].student_id);
      }

      // 格式化日期显示
      const fmtDate = (d) => {
        if (!d) return '';
        const s = typeof d === 'string' ? d : d.toString();
        return s.length === 10 ? s.slice(5) : s.slice(0, 10); // "06-03"
      };

      const recentLessons = lessons.map(l => ({ ...l, _dateShort: fmtDate(l.date) }));

      // DEBUG: setData 前检查
      console.log('[DEBUG] recentLessons 映射后条数:', recentLessons.length);
      console.log('[DEBUG] recentLessons[0]._dateShort:', recentLessons[0] ? recentLessons[0]._dateShort : 'N/A');
      console.log('[DEBUG] isEdit:', this.data.isEdit);

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

      // DEBUG: setData 后检查
      console.log('[DEBUG] setData后 recentLessons.length:', this.data.recentLessons.length);
      console.log('[DEBUG] setData后 displayLessons.length:', this.data.displayLessons.length);
    } catch (err) {
      console.error('加载学员数据失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // ===== 头像 =====

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

  // ===== 表单字段 =====

  onFieldChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [`form.${field}`]: value });
  },

  onGenderTap(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ 'form.gender': value === this.data.form.gender ? '' : value });
  },

  // ===== 保存 =====

  async onSave() {
    const { form, isEdit, studentId } = this.data;

    // 校验必填字段
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

      // 延迟返回上一页
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      console.error('保存失败:', err);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  // ===== 分享邀请学员 =====

  onShareToStudent() {
    // 触发微信分享对话框（配合 WXML 的 open-type="share"）
    // onShareAppMessage 会自动被调用
  },

  onShareAppMessage() {
    const { student, studentId } = this.data;
    const app = getApp();
    return {
      title: `${student.name || '学员'}，快来绑定你的私教助手`,
      path: `/pages/common/login-guide/login-guide?student_id=${studentId}&coach_openid=${app.globalData.openid}`,
      imageUrl: student.avatar_url || ''
    };
  },

  // ===== 课时卡管理 =====

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

  // 阻止弹窗内部点击冒泡（空函数）
  noop() {},

  onRechargeInput(e) {
    this.setData({ rechargeAmount: e.detail.value });
  },

  onRechargeReasonInput(e) {
    this.setData({ rechargeReason: e.detail.value });
  },

  async onConfirmRecharge() {
    const { rechargeAmount, rechargeReason, rechargeMode, studentId, student } = this.data;
    const amount = parseInt(rechargeAmount);

    if (isNaN(amount) || amount <= 0) {
      wx.showToast({ title: '请输入有效的课时数', icon: 'none' });
      return;
    }

    const changeAmount = rechargeMode === 'deduct' ? -amount : amount;
    const newBalance = (student.remaining_lessons || 0) + changeAmount;

    if (newBalance < 0) {
      wx.showToast({ title: '扣减后课时不能为负数', icon: 'none' });
      return;
    }

    this.setData({ recharging: true });

    try {
      // 1. 写入日志
      await addLessonCardLog({
        student_id: studentId,
        change_amount: changeAmount,
        balance_after: newBalance,
        reason: rechargeReason || (rechargeMode === 'deduct' ? '手动扣减' : '课时充值')
      });

      // 2. 更新学员剩余课时
      await updateStudent(studentId, { remaining_lessons: newBalance });

      wx.showToast({ title: rechargeMode === 'deduct' ? '扣减成功' : '充值成功', icon: 'success' });

      // 3. 刷新页面数据
      this.setData({ rechargeVisible: false, recharging: false });
      this.loadData(studentId);
    } catch (err) {
      console.error('课时操作失败:', err);
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      this.setData({ recharging: false });
    }
  },

  // ===== 课程历史 =====

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
    // 其他状态暂不处理，后续可扩展
  },

  // ===== 课时卡详情弹窗 =====

  onShowLessonCardDetail() {
    this.setData({ showLessonCardDetail: true });
  },

  onCloseLessonCardDetail() {
    this.setData({ showLessonCardDetail: false });
  }
});
