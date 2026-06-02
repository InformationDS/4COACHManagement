// pages/student/lesson-detail/lesson-detail.js
const { getLessonDetail, getTrainingRecord, updateLesson } = require('../../../utils/api');

Page({
  data: {
    loading: true,
    lesson: {},
    trainingRecord: null
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

  async onConfirm() {
    if (this.data.lesson.status !== 'pending') return;
    try {
      await updateLesson(this.data.lesson._id, { status: 'confirmed' });
      wx.showToast({ title: '已确认', icon: 'success' });
      this.loadData(this.data.lesson._id);
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  async onCancel() {
    if (this.data.lesson.status !== 'pending') return;
    const res = await new Promise(r => wx.showModal({ title: '取消课程', content: '确定取消？', success: r }));
    if (!res.confirm) return;
    try {
      await updateLesson(this.data.lesson._id, { status: 'cancelled' });
      wx.showToast({ title: '已取消', icon: 'success' });
      this.loadData(this.data.lesson._id);
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  }
});
