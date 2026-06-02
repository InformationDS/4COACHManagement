// pages/common/login-guide/login-guide.js - 未注册引导页
const { bindUserRole } = require('../../../utils/api');

Page({
  data: {
    binding: false
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

        // 刷新全局角色信息
        const app = getApp();
        await app.refreshUserRole();

        // 跳转到教练首页
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
        const { getHomePath } = require('../../../utils/role');
        wx.redirectTo({ url: getHomePath(app.getRole()) });
      } else {
        wx.showToast({ title: '未检测到账号，请先注册', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '检测失败', icon: 'none' });
    }
  }
});
