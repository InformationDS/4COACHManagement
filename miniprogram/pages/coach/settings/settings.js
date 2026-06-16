// pages/coach/settings/settings.js
const {
  getCoachSettings,
  saveCoachSettings,
  getCurrentUser,
  saveCurrentUserProfile
} = require('../../../utils/api');
const { getAiStatus } = require('../../../utils/aiApi');

Page({
  data: {
    loading: true,
    saving: false,
    profile: {
      name: '',
      phone: ''
    },
    settings: {
      lesson_duration: 60,
      common_locations: []
    },
    aiStatus: {
      aiAvailable: true,
      voiceAvailable: false,
      modelMode: '',
      message: ''
    },
    newLocation: '',
    _firstLoad: true
  },

  async onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(3);
    }
    if (this.data._firstLoad) {
      this.setData({ _firstLoad: false });
      await this.loadSettings();
    }
  },

  async loadSettings() {
    this.setData({ loading: true });
    try {
      const [settings, user, aiStatus] = await Promise.all([
        getCoachSettings(),
        getCurrentUser(),
        getAiStatus()
      ]);

      this.setData({
        profile: {
          name: user ? (user.name || '') : '',
          phone: user ? (user.phone || '') : ''
        },
        settings: {
          lesson_duration: settings ? (settings.lesson_duration || 60) : 60,
          common_locations: settings ? (settings.common_locations || []) : []
        },
        aiStatus,
        loading: false
      });
    } catch (e) {
      console.error('加载设置失败:', e);
      this.setData({ loading: false });
    }
  },

  onProfileInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`profile.${field}`]: e.detail.value });
  },

  onDurationInput(e) {
    this.setData({ 'settings.lesson_duration': parseInt(e.detail.value) || 60 });
  },

  onLocationInput(e) {
    this.setData({ newLocation: e.detail.value });
  },

  onAddLocation() {
    const value = this.data.newLocation.trim();
    if (!value) return;
    this.setData({
      'settings.common_locations': [...this.data.settings.common_locations, value],
      newLocation: ''
    });
  },

  onDeleteLocation(e) {
    const index = e.currentTarget.dataset.index;
    const locations = [...this.data.settings.common_locations];
    locations.splice(index, 1);
    this.setData({ 'settings.common_locations': locations });
  },

  async onSave() {
    this.setData({ saving: true });
    try {
      await Promise.all([
        saveCoachSettings(this.data.settings),
        saveCurrentUserProfile(this.data.profile)
      ]);

      const app = getApp();
      app.globalData.userInfo = {
        ...(app.globalData.userInfo || {}),
        ...this.data.profile
      };

      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      console.error('保存设置失败:', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
