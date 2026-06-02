// pages/student/mine/mine.js
const { getCurrentUser } = require('../../../utils/api');
const { formatDateTime } = require('../../../utils/date');

Page({
  data: {
    student: {},
    logs: [],
    studentId: ''
  },

  async onShow() {
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
  }
});
