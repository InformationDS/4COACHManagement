// components/student-tabbar/student-tabbar.js
Component({
  properties: {
    active: { type: String, value: 'booking' }
  },
  methods: {
    onTap(e) {
      const page = e.currentTarget.dataset.page;
      if (page === this.data.active) return;
      const urlMap = {
        booking: '/pages/student/booking/booking',
        lessons: '/pages/student/my-lessons/my-lessons',
        mine: '/pages/student/mine/mine'
      };
      wx.redirectTo({ url: urlMap[page] || urlMap.booking });
    }
  }
});
