// custom-tab-bar/index.js - coach-only tab bar
Component({
  data: {
    selected: 0,
    tabs: [
      { pagePath: '/pages/coach/ai-assistant/ai-assistant', text: 'AI助手' },
      { pagePath: '/pages/coach/lessons/lessons', text: '日程' },
      { pagePath: '/pages/coach/students/students', text: '学员' },
      { pagePath: '/pages/coach/settings/settings', text: '我的' }
    ]
  },

  methods: {
    setSelected(index) {
      this.setData({ selected: index });
    },

    onTap(e) {
      const { index, path } = e.currentTarget.dataset;
      this.setData({ selected: index });

      wx.switchTab({
        url: path,
        fail: () => {
          wx.redirectTo({ url: path });
        }
      });
    }
  }
});
