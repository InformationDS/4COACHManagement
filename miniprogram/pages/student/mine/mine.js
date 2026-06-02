// pages/student/mine/mine.js
const { formatDateTime } = require('../../../utils/date');

Page({
  data: {
    student: {},
    logs: [],
    studentId: '',

    // 编辑弹窗
    editModalVisible: false,
    editField: '',       // 'location_preference' | 'notes'
    editLabel: '',       // 弹窗标题
    editValue: '',       // 当前编辑值
    editing: false
  },

  async onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(2);
    }
    await this.loadMine();
  },

  async loadMine() {
    try {
      const app = getApp();
      const userInfo = app.globalData.userInfo;
      const studentId = userInfo ? userInfo.student_id : '';
      this.setData({ studentId });

      if (studentId) {
        const { getStudentDetail, getLessonCardLogs } = require('../../../utils/api');
        const [student, logs] = await Promise.all([
          getStudentDetail(studentId).catch(() => ({})),
          getLessonCardLogs(studentId).catch(() => [])
        ]);
        this.setData({
          student,
          logs: logs.map(l => ({ ...l, timeText: l.created_at ? formatDateTime(l.created_at) : '' }))
        });
      }
    } catch (e) {
      console.error('加载学员信息失败:', e);
    }
  },

  // ===== 编辑偏好 / 诉求 =====
  onEditLocation() {
    this.setData({
      editModalVisible: true,
      editField: 'location_preference',
      editLabel: '上课地点偏好',
      editValue: this.data.student.location_preference || ''
    });
  },

  onEditNotes() {
    this.setData({
      editModalVisible: true,
      editField: 'notes',
      editLabel: '特殊诉求',
      editValue: this.data.student.notes || ''
    });
  },

  onEditInput(e) {
    this.setData({ editValue: e.detail.value });
  },

  onCloseEdit() {
    this.setData({ editModalVisible: false });
  },

  async onSaveEdit() {
    const { studentId, editField, editValue, student } = this.data;
    this.setData({ editing: true });
    try {
      const { updateStudent } = require('../../../utils/api');
      await updateStudent(studentId, { [editField]: editValue.trim() });
      // 更新本地数据
      student[editField] = editValue.trim();
      this.setData({ student, editModalVisible: false });
      wx.showToast({ title: '已更新', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '更新失败', icon: 'none' });
    }
    this.setData({ editing: false });
  }
});
