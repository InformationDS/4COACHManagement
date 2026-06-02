// pages/coach/students/students.js
const { getStudents } = require('../../../utils/api');
const { formatDate } = require('../../../utils/date');

Page({
  data: {
    students: [],
    keyword: '',
    loading: true,
    searchTimer: null
  },

  onShow() {
    this.loadStudents();
  },

  /**
   * 加载学员列表
   */
  async loadStudents() {
    this.setData({ loading: true });
    try {
      const keyword = this.data.keyword.trim();
      const students = await getStudents(keyword);
      // 格式化日期
      const formatted = students.map(s => ({
        ...s,
        last_lesson_date: s.last_lesson_date ? formatDate(s.last_lesson_date) : ''
      }));
      this.setData({ students: formatted, loading: false });
    } catch (err) {
      console.error('加载学员列表失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  /**
   * 搜索输入（防抖）
   */
  onSearchInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    // 清除之前的定时器
    if (this.data.searchTimer) clearTimeout(this.data.searchTimer);
    // 300ms 防抖
    this.data.searchTimer = setTimeout(() => {
      this.loadStudents();
    }, 300);
  },

  /**
   * 清除搜索
   */
  onClearSearch() {
    this.setData({ keyword: '' });
    this.loadStudents();
  },

  /**
   * 点击学员卡片 → 进入详情
   */
  onTapStudent(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/coach/student-detail/student-detail?id=${id}`
    });
  },

  /**
   * 添加新学员
   */
  onAddStudent() {
    wx.navigateTo({
      url: '/pages/coach/student-detail/student-detail'
    });
  }
});
