// pages/student/my-lessons/my-lessons.js
const { formatDate, getWeekdayName } = require('../../../utils/date');
const { getLessons } = require('../../../utils/api');

Page({
  data: {
    activeTab: 'upcoming',
    allLessons: [],
    showList: []
  },

  onShow() { this.loadLessons(); },

  async loadLessons() {
    try {
      const lessons = await getLessons();
      const formatted = lessons.map(l => ({
        ...l,
        dateText: `${l.date} ${getWeekdayName(l.date)}`
      }));
      this.setData({ allLessons: formatted });
      this._filter();
    } catch (e) {
      console.error('加载课程失败:', e);
    }
  },

  onTabTap(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
    this._filter();
  },

  _filter() {
    const { allLessons, activeTab } = this.data;
    const list = activeTab === 'upcoming'
      ? allLessons.filter(l => l.status === 'pending' || l.status === 'confirmed')
      : allLessons.filter(l => l.status === 'completed' || l.status === 'cancelled');
    list.sort((a, b) => {
      const da = a.date + a.start_time;
      const db = b.date + b.start_time;
      return activeTab === 'upcoming' ? da.localeCompare(db) : db.localeCompare(da);
    });
    this.setData({ showList: list });
  },

  onTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/student/lesson-detail/lesson-detail?id=${id}` });
  }
});
