// pages/student/lesson-detail/lesson-detail.js
const { getLessonDetail, getTrainingRecord, updateLesson } = require('../../../utils/api');
const { sendSubscribeMessage, getCoachOpenid } = require('../../../utils/api');
const { formatDate } = require('../../../utils/date');

Page({
  data: {
    loading: true,
    lesson: {},
    trainingRecord: null,
    // 取消弹窗
    showCancelModal: false,
    cancelReason: ''
  },

  onLoad(options) {
    if (options.id) this.loadData(options.id);
  },

  async loadData(id) {
    this.setData({ loading: true });
    try {
      const lesson = await getLessonDetail(id);
      let record = null;
      if (lesson.status === 'completed') {
        try { record = await getTrainingRecord(id); } catch (e) { /* ignore */ }
      }
      this.setData({ lesson, trainingRecord: record, loading: false });
    } catch (e) {
      console.error('加载失败:', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // ===== 确认课程 =====
  async onConfirm() {
    const lesson = this.data.lesson;
    if (lesson.status !== 'pending') return;

    try {
      // 请求订阅消息授权
      this._requestSubscribe();

      await updateLesson(lesson._id, { status: 'confirmed' });
      wx.showToast({ title: '已确认', icon: 'success' });

      // 通知教练
      this._notifyCoach(lesson, 'confirm_notify', '学员已确认课程');

      this.loadData(lesson._id);
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // ===== 取消课程（打开原因输入弹窗）=====
  onCancel() {
    const { status } = this.data.lesson;
    if (status !== 'pending' && status !== 'confirmed') return;
    this.setData({ showCancelModal: true, cancelReason: '' });
  },

  // 确认取消
  async onConfirmCancel() {
    const lesson = this.data.lesson;
    const reason = this.data.cancelReason.trim() || '学员取消';
    this.setData({ showCancelModal: false });

    // 请求订阅消息授权
    this._requestSubscribe();

    try {
      await updateLesson(lesson._id, {
        status: 'cancelled',
        cancel_by: 'student',
        cancel_reason: reason
      });
      wx.showToast({ title: '已取消', icon: 'success' });

      // 通知教练
      this._notifyCoach(lesson, 'cancel_notify', reason);

      this.loadData(lesson._id);
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 关闭取消弹窗
  onCloseCancelModal() { this.setData({ showCancelModal: false }); },

  // 取消原因输入
  onCancelReasonInput(e) { this.setData({ cancelReason: e.detail.value }); },

  // ===== 私有方法 =====

  /**
   * 请求订阅消息授权
   */
  _requestSubscribe() {
    const tmplIds = [];
    if (tmplIds.length === 0) return;

    wx.requestSubscribeMessage({
      tmplIds: tmplIds,
      success: (res) => console.log('订阅消息授权结果:', res),
      fail: (err) => console.warn('订阅消息授权失败:', err)
    });
  },

  /**
   * 通知教练
   */
  async _notifyCoach(lesson, scene, reason) {
    try {
      const coachOpenid = lesson.coach_openid;
      if (!coachOpenid) {
        console.warn('课程缺少教练 openid，无法发送通知');
        return;
      }
      const date = typeof lesson.date === 'string' ? lesson.date : formatDate(lesson.date);
      await sendSubscribeMessage({
        scene,
        toOpenid: coachOpenid,
        data: {
          thing1: lesson.student_name || '学员',
          thing2: scene === 'cancel_notify' ? (reason || '课程已取消') : '已确认',
          time3: `${lesson.start_time}-${lesson.end_time}`,
          date4: date,
          phrase5: scene === 'confirm_notify' ? '已确认' : '已取消'
        }
      });
    } catch (e) {
      console.warn('通知教练失败:', e);
    }
  }
});
