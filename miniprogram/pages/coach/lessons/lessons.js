const api = require("../../../utils/api");
const date = require("../../../utils/date");

function setTab(page) {
  if (typeof page.getTabBar === "function" && page.getTabBar()) {
    page.getTabBar().setData({ selected: 1 });
  }
}

Page({
  data: {
    viewMode: "day",
    selectedDate: date.formatDate(new Date()),
    lessons: [],
    cancelledLessons: [],
    weekStats: { total: 0, completed: 0, pending: 0 },
    loading: false
  },

  onShow() {
    setTab(this);
    this.loadLessons();
  },

  switchMode(event) {
    this.setData({ viewMode: event.currentTarget.dataset.mode });
    this.loadLessons();
  },

  changeDate(event) {
    this.setData({ selectedDate: event.detail.value });
    this.loadLessons();
  },

  loadLessons() {
    const base = new Date(`${this.data.selectedDate}T00:00:00`);
    const start = this.data.viewMode === "week" ? date.startOfWeek(base) : date.startOfDay(base);
    const end = this.data.viewMode === "week" ? date.endOfWeek(base) : date.endOfDay(base);
    this.setData({ loading: true });
    api.getLessonsByRange(start.toISOString(), end.toISOString())
      .then((res) => {
        const all = res.data || [];
        const active = all.filter((item) => item.status !== "cancelled");
        const cancelled = all.filter((item) => item.status === "cancelled");
        this.setData({
          lessons: active,
          cancelledLessons: cancelled,
          weekStats: {
            total: active.length,
            completed: active.filter((item) => item.status === "completed").length,
            pending: active.filter((item) => item.status !== "completed").length
          },
          loading: false
        });
      })
      .catch((err) => {
        this.setData({ loading: false });
        api.toastError(err);
      });
  },

  openForm() {
    wx.navigateTo({ url: `/pages/coach/lesson-form/lesson-form?date=${this.data.selectedDate}` });
  },

  openLesson(event) {
    wx.navigateTo({ url: `/pages/coach/lesson-detail/lesson-detail?id=${event.currentTarget.dataset.id}` });
  },

  askAiSchedule() {
    wx.switchTab({ url: "/pages/coach/ai-assistant/ai-assistant" });
  }
});
