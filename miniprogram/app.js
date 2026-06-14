// app.js - 自由私人教练助手
// 全局入口：云开发初始化、角色识别

App({
  globalData: {
    openid: '',       // 当前用户 openid
    role: '',         // 'coach' | 'student' | 'unknown'
    userInfo: null,   // 当前用户信息
    ready: false      // 初始化完成标志
  },

  onLaunch() {
    // 初始化云开发
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      this.globalData.ready = true;
      return;
    }

    wx.cloud.init({
      env: 'cloud1-d6gspyhgucab5be98',
      traceUser: true
    });

    // 云环境初始化后延迟一下再调云函数（避免环境初始化未完成就调用）
    this._initUserRole();
  },

  /**
   * 获取 openid 并确定角色
   */
  async _initUserRole() {
    try {
      // 1. 获取 openid
      const res = await wx.cloud.callFunction({
        name: 'getOpenid'
      });
      const openid = res.result.openid;
      this.globalData.openid = openid;
      console.log('openid 获取成功');

      // 2. 查 users 表
      try {
        const db = wx.cloud.database();
        const userRes = await db.collection('users')
          .where({ _openid: openid })
          .limit(1)
          .get();

        if (userRes.data && userRes.data.length > 0) {
          const user = userRes.data[0];
          if (user.role === 'student') {
            this.globalData.role = 'unknown';
            this.globalData.userInfo = null;
            console.log('旧学员角色已暂不开放');
          } else {
            this.globalData.role = user.role;
            this.globalData.userInfo = user;
            console.log('用户角色：', user.role);
          }
        } else {
          this.globalData.role = 'unknown';
          console.log('未注册用户');
        }
      } catch (dbErr) {
        console.error('数据库查询失败：', dbErr);
        this.globalData.role = 'unknown';
      }
    } catch (err) {
      console.error('初始化失败：', err);
      // 超时或其他错误，直接标记为 unknown
      this.globalData.role = 'unknown';
    } finally {
      this.globalData.ready = true;
    }
  },

  /**
   * 刷新用户角色信息
   */
  async refreshUserRole() {
    this.globalData.ready = false;
    await this._initUserRole();
  },

  isRegistered() {
    return this.globalData.role !== 'unknown' && this.globalData.role !== '';
  },

  getRole() {
    return this.globalData.role;
  }
});
