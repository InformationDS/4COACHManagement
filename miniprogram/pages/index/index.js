// pages/index/index.js - 入口页逻辑：角色判断与分发
const roleUtil = require('../../utils/role');
const { getHomePath } = roleUtil;

Page({
  data: {
    loading: true,
    role: '',
    roleText: ''
  },

  onShow() {
    this._waitForInit();
  },

  /**
   * 等待 app 初始化完成后分发
   */
  _waitForInit() {
    const app = getApp();
    const startTime = Date.now();
    const maxWait = 30000; // 30 秒总超时

    const check = () => {
      const role = app.getRole();

      // 角色已确定（包括 unknown）
      if (app.globalData.ready) {
        this._handleReady(role);
        return;
      }

      if (Date.now() - startTime > maxWait) {
        console.warn('初始化超时，强制进入引导页');
        this._handleReady('unknown');
        return;
      }

      setTimeout(check, 500);
    };

    check();
  },

  _handleReady(role) {
    const roleTextMap = {
      coach: '教练',
      student: '学员',
      unknown: ''
    };

    this.setData({
      loading: false,
      role: role || 'unknown',
      roleText: roleTextMap[role] || ''
    });

    // 跳转到对应页面
    const path = getHomePath(role || 'unknown');
    setTimeout(() => {
      wx.switchTab({ url: path }).catch(() => {
        wx.redirectTo({ url: path });
      });
    }, 600);
  }
});
