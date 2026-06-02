// custom-tab-bar/index.js - 自定义 tabBar，按角色动态渲染
Component({
  data: {
    selected: 0,
    role: 'coach',
    coachTabs: [
      { pagePath: '/pages/coach/lessons/lessons', text: '课程', icon: '📋' },
      { pagePath: '/pages/coach/students/students', text: '学员', icon: '👥' },
      { pagePath: '/pages/coach/settings/settings', text: '我的', icon: '👤' }
    ],
    studentTabs: [
      { pagePath: '/pages/student/booking/booking', text: '约课', icon: '📅' },
      { pagePath: '/pages/student/my-lessons/my-lessons', text: '课程', icon: '📋' },
      { pagePath: '/pages/student/mine/mine', text: '我的', icon: '👤' }
    ]
  },

  lifetimes: {
    attached() {
      const app = getApp();
      this.setData({ role: app.getRole() || 'coach' });
    }
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
