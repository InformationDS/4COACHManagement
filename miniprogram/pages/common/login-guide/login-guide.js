// pages/common/login-guide/login-guide.js - 未注册引导页
const { bindUserRole } = require('../../../utils/api');

Page({
  data: {
    binding: false
  },

  onLoad() {
    // 已注册用户直接跳走
    const app = getApp();
    if (app.globalData.ready && app.isRegistered()) {
      const { navigateToHome } = require('../../../utils/role');
      navigateToHome(app.getRole());
      return;
    }
    // 如果还没 ready，等一下再检测
    if (!app.globalData.ready) {
      this._waitAndRedirect();
    }
  },

  _waitAndRedirect() {
    const app = getApp();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (app.globalData.ready) {
        clearInterval(timer);
        if (app.isRegistered()) {
          const { navigateToHome } = require('../../../utils/role');
          navigateToHome(app.getRole());
        }
      }
      if (attempts > 20) clearInterval(timer); // 最多等 10s
    }, 500);
  },

  /**
   * 教练绑定身份
   */
  async onBindCoach() {
    this.setData({ binding: true });

    try {
      const res = await bindUserRole('coach');
      if (res.success) {
        wx.showToast({ title: '教练身份绑定成功', icon: 'success' });

        const app = getApp();
        await app.refreshUserRole();

        setTimeout(() => {
          wx.switchTab({
            url: '/pages/coach/lessons/lessons'
          });
        }, 800);
      } else {
        wx.showToast({ title: res.message || '绑定失败', icon: 'none' });
      }
    } catch (err) {
      console.error('绑定教练失败:', err);
      wx.showToast({ title: '绑定失败，请重试', icon: 'none' });
    } finally {
      this.setData({ binding: false });
    }
  },

  /**
   * 重新检测账号
   */
  async onRetry() {
    wx.showLoading({ title: '检测中...' });

    try {
      const app = getApp();
      await app.refreshUserRole();

      wx.hideLoading();

      if (app.isRegistered()) {
        const { navigateToHome } = require('../../../utils/role');
        navigateToHome(app.getRole());
      } else {
        wx.showToast({ title: '未检测到账号，请先注册', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '检测失败', icon: 'none' });
    }
  }
});
