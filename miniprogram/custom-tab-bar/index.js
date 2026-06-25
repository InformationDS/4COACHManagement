Component({
  data: {
    selected: 0,
    tabs: [
      { pagePath: "/pages/coach/ai-assistant/ai-assistant", text: "AI助手" },
      { pagePath: "/pages/coach/lessons/lessons", text: "日程" },
      { pagePath: "/pages/coach/students/students", text: "学员" },
      { pagePath: "/pages/coach/settings/settings", text: "我的" }
    ]
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab) return;
      wx.switchTab({ url: tab.pagePath });
    }
  }
});
