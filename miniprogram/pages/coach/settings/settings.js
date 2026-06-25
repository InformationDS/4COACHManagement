const api = require("../../../utils/api");

function setTab(page) {
  if (typeof page.getTabBar === "function" && page.getTabBar()) {
    page.getTabBar().setData({ selected: 3 });
  }
}

Page({
  data: {
    coach: null,
    defaultDuration: 60,
    feedback: ""
  },

  onShow() {
    setTab(this);
    api.initUser({ action: "get" })
      .then((res) => this.setData({
        coach: res.user,
        defaultDuration: res.settings && res.settings.default_lesson_duration ? res.settings.default_lesson_duration : 60
      }))
      .catch(api.toastError);
  },

  inputDuration(event) {
    this.setData({ defaultDuration: Number(event.detail.value) || 60 });
  },

  saveSettings() {
    api.initUser({ action: "saveSettings", settings: { default_lesson_duration: this.data.defaultDuration } })
      .then(() => wx.showToast({ title: "已保存" }))
      .catch(api.toastError);
  },

  openActionLibrary() {
    wx.navigateTo({ url: "/pages/coach/action-library/action-library" });
  },

  inputFeedback(event) {
    this.setData({ feedback: event.detail.value });
  },

  submitFeedback() {
    if (!this.data.feedback.trim()) {
      wx.showToast({ title: "请填写反馈内容", icon: "none" });
      return;
    }
    api.initUser({ action: "feedback", content: this.data.feedback })
      .then(() => {
        wx.showToast({ title: "已提交" });
        this.setData({ feedback: "" });
      })
      .catch(api.toastError);
  }
});
