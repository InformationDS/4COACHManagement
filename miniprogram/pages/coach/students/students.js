const api = require("../../../utils/api");

function setTab(page) {
  if (typeof page.getTabBar === "function" && page.getTabBar()) {
    page.getTabBar().setData({ selected: 2 });
  }
}

Page({
  data: {
    keyword: "",
    students: [],
    loading: false
  },

  onShow() {
    setTab(this);
    this.load();
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.value });
    this.load();
  },

  load() {
    this.setData({ loading: true });
    api.getStudents(this.data.keyword)
      .then((res) => this.setData({ students: res.data || [], loading: false }))
      .catch((err) => {
        this.setData({ loading: false });
        api.toastError(err);
      });
  },

  addStudent() {
    wx.navigateTo({ url: "/pages/coach/student-detail/student-detail" });
  },

  openStudent(event) {
    wx.navigateTo({ url: `/pages/coach/student-detail/student-detail?id=${event.currentTarget.dataset.id}` });
  }
});
