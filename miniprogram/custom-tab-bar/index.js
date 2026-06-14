// custom-tab-bar/index.js - 教练单人模式 tabBar
Component({
  data: {
    selected: 0,
    tabs: [
      { pagePath: '/pages/coach/lessons/lessons', text: '日程' },
      { pagePath: '/pages/coach/students/students', text: '学员' },
      { pagePath: '/pages/coach/settings/settings', text: '我的' }
    ]
  },

  methods: {
    // 外部调用：设置当前选中 tab
    setSelected(index) {
      this.setData({ selected: index });
    },

    onTap(e) {
      const { index, path } = e.currentTarget.dataset;
      this.setData({ selected: index });

      wx.switchTab({
        url: path,
        fail: () => {
          // switchTab 失败时用 redirectTo 兜底
          wx.redirectTo({ url: path });
        }
      });
    }
  }
});
