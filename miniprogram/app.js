const ENV_ID = "cloud1-d6gspyhgucab5be98";

App({
  globalData: {
    env: ENV_ID,
    coach: null
  },

  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: "基础库过低",
        content: "当前微信版本不支持云开发，请升级微信后重试。",
        showCancel: false
      });
      return;
    }

    wx.cloud.init({
      env: ENV_ID,
      traceUser: true
    });

    this.ensureCoach();
  },

  ensureCoach() {
    wx.cloud.callFunction({
      name: "initUser",
      data: {},
      success: (res) => {
        if (res && res.result && res.result.success) {
          this.globalData.coach = res.result.user;
        }
      },
      fail: (err) => {
        console.error("initUser failed", err);
      }
    });
  }
});
