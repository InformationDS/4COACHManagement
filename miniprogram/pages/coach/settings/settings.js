// pages/coach/settings/settings.js
const { getCoachSettings, saveCoachSettings } = require('../../../utils/api');

Page({
  data: {
    loading: true,
    saving: false,
    settings: {
      lesson_duration: 60,
      common_locations: [],
      daily_start_time: '08:00',
      daily_end_time: '20:00'
    },
    newLocation: '',
    _firstLoad: true
  },

  async onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(2);
    }
    if (this.data._firstLoad) {
      this.setData({ _firstLoad: false });
      await this.loadSettings();
    }
  },

  async loadSettings() {
    this.setData({ loading: true });
    try {
      const s = await getCoachSettings();
      this.setData({
        settings: {
          lesson_duration: s ? (s.lesson_duration || 60) : 60,
          common_locations: s ? (s.common_locations || []) : [],
          daily_start_time: s ? (s.daily_start_time || '08:00') : '08:00',
          daily_end_time: s ? (s.daily_end_time || '20:00') : '20:00'
        },
        loading: false
      });
    } catch (e) {
      console.error('加载设置失败:', e);
      this.setData({ loading: false });
    }
  },

  onDurationInput(e) {
    this.setData({ 'settings.lesson_duration': parseInt(e.detail.value) || 60 });
  },

  onDailyStartInput(e) {
    this.setData({ 'settings.daily_start_time': e.detail.value });
  },

  onDailyEndInput(e) {
    this.setData({ 'settings.daily_end_time': e.detail.value });
  },

  onLocationInput(e) {
    this.setData({ newLocation: e.detail.value });
  },

  onAddLocation() {
    const v = this.data.newLocation.trim();
    if (!v) return;
    this.setData({
      'settings.common_locations': [...this.data.settings.common_locations, v],
      newLocation: ''
    });
  },

  onDeleteLocation(e) {
    const idx = e.currentTarget.dataset.index;
    const locs = [...this.data.settings.common_locations];
    locs.splice(idx, 1);
    this.setData({ 'settings.common_locations': locs });
  },

  async onSave() {
    this.setData({ saving: true });
    try {
      await saveCoachSettings(this.data.settings);
      wx.showToast({ title: '设置已保存', icon: 'success' });
    } catch (e) {
      console.error('保存设置失败:', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
