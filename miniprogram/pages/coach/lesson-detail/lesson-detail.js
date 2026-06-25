const api = require("../../../utils/api");

Page({
  data: {
    lessonId: "",
    lesson: null
  },

  onLoad(options) {
    this.setData({ lessonId: options.id || "" });
    this.load();
  },

  onShow() {
    if (this.data.lessonId) this.load();
  },

  load() {
    if (!this.data.lessonId) return;
    api.getLesson(this.data.lessonId)
      .then((res) => this.setData({ lesson: res.data }))
      .catch(api.toastError);
  },

  edit() {
    wx.navigateTo({ url: `/pages/coach/lesson-form/lesson-form?id=${this.data.lessonId}` });
  },

  recordTraining() {
    const app = getApp();
    app.globalData.pendingAiSourceContext = {
      source: "lesson_detail",
      lesson_id: this.data.lessonId,
      student_id: this.data.lesson ? this.data.lesson.student_id : "",
      lesson_label: this.data.lesson ? `${this.data.lesson.student_name} ${this.data.lesson.date} ${this.data.lesson.start_time}` : ""
    };
    wx.switchTab({ url: "/pages/coach/ai-assistant/ai-assistant" });
  },

  complete() {
    wx.showModal({
      title: "完课确认",
      content: `确认完成课程并扣减 ${this.data.lesson.lesson_units || 1} 课时？`,
      success: (res) => {
        if (!res.confirm) return;
        api.completeLesson(this.data.lessonId)
          .then(() => {
            wx.showToast({ title: "已完成" });
            this.load();
          })
          .catch(api.toastError);
      }
    });
  },

  cancelLesson() {
    wx.showModal({
      title: "取消课程",
      content: "取消后不扣课时，并释放时间冲突。",
      success: (res) => {
        if (!res.confirm) return;
        api.cancelLesson(this.data.lessonId, "")
          .then(() => {
            wx.showToast({ title: "已取消" });
            this.load();
          })
          .catch(api.toastError);
      }
    });
  }
});
