// app.js - private coach assistant
App({
  globalData: {
    openid: '',
    role: '',
    userInfo: null,
    ready: false,
    pendingSchedule: null,
    pendingAiRequest: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('Please use base library 2.2.3 or above for cloud capability.');
      this.globalData.ready = true;
      return;
    }

    wx.cloud.init({
      env: 'cloud1-d6gspyhgucab5be98',
      traceUser: true
    });

    this._initUserRole();
  },

  async _initUserRole() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getOpenid' });
      const openid = res.result.openid;
      this.globalData.openid = openid;

      try {
        const db = wx.cloud.database();
        const userRes = await db.collection('users')
          .where({ _openid: openid })
          .limit(1)
          .get();

        if (userRes.data && userRes.data.length > 0) {
          const user = userRes.data[0];
          this.globalData.role = user.role === 'coach' ? 'coach' : 'unknown';
          this.globalData.userInfo = this.globalData.role === 'coach' ? user : null;
        } else {
          this.globalData.role = 'unknown';
          this.globalData.userInfo = null;
        }
      } catch (dbErr) {
        console.error('Failed to query user role:', dbErr);
        this.globalData.role = 'unknown';
        this.globalData.userInfo = null;
      }
    } catch (err) {
      console.error('Failed to initialize user role:', err);
      this.globalData.role = 'unknown';
      this.globalData.userInfo = null;
    } finally {
      this.globalData.ready = true;
    }
  },

  async refreshUserRole() {
    this.globalData.ready = false;
    await this._initUserRole();
  },

  isRegistered() {
    return this.globalData.role === 'coach';
  },

  getRole() {
    return this.globalData.role;
  }
});
