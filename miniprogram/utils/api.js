// utils/api.js - 云函数调用封装

const db = wx.cloud.database();
const _ = db.command;

/**
 * 调用云函数
 * @param {string} name - 云函数名称
 * @param {object} data - 参数
 * @returns {Promise<any>}
 */
async function callCloud(name, data = {}) {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    return res.result;
  } catch (err) {
    console.error(`云函数 [${name}] 调用失败:`, err);
    throw err;
  }
}

// ===== users 表操作 =====

/**
 * 获取当前用户信息
 */
async function getCurrentUser() {
  const app = getApp();
  const res = await db.collection('users')
    .where({ _openid: app.globalData.openid })
    .get();
  return res.data[0] || null;
}

/**
 * 绑定用户角色
 * @param {'coach' | 'student'} role
 * @param {object} extra - 额外信息
 */
async function bindUserRole(role, extra = {}) {
  return callCloud('initUser', { role, ...extra });
}

// ===== students 表操作 =====

/**
 * 获取学员列表（教练端）
 * @param {string} keyword - 搜索关键词（可选）
 */
async function getStudents(keyword = '') {
  const app = getApp();
  let query = db.collection('students')
    .where({ coach_openid: app.globalData.openid });

  if (keyword) {
    query = query.where({
      coach_openid: app.globalData.openid,
      name: db.RegExp({ regexp: keyword, options: 'i' })
    });
  }

  const res = await query.orderBy('created_at', 'desc').get();
  return res.data;
}

/**
 * 获取单个学员详情
 * @param {string} studentId
 */
async function getStudentDetail(studentId) {
  const res = await db.collection('students').doc(studentId).get();
  return res.data;
}

/**
 * 添加学员
 * @param {object} data - 学员信息
 */
async function addStudent(data) {
  const app = getApp();
  return db.collection('students').add({
    data: {
      ...data,
      coach_openid: app.globalData.openid,
      remaining_lessons: data.remaining_lessons || 0,
      created_at: new Date(),
      updated_at: new Date()
    }
  });
}

/**
 * 更新学员信息
 * @param {string} studentId
 * @param {object} data
 */
async function updateStudent(studentId, data) {
  return db.collection('students').doc(studentId).update({
    data: { ...data, updated_at: new Date() }
  });
}

// ===== lessons 表操作 =====

/**
 * 获取课程列表
 * @param {object} filters - 筛选项
 */
async function getLessons(filters = {}) {
  const app = getApp();
  const role = app.getRole();

  let query = db.collection('lessons');

  // 按角色过滤
  if (role === 'coach') {
    query = query.where({ coach_openid: app.globalData.openid });
  } else {
    // 学员只看自己的课程 - 需要通过 student_id
    const userInfo = app.globalData.userInfo;
    if (userInfo && userInfo.student_id) {
      query = query.where({ student_id: userInfo.student_id });
    }
  }

  // 按日期范围过滤
  if (filters.startDate && filters.endDate) {
    query = query.where({
      date: _.gte(filters.startDate).and(_.lte(filters.endDate))
    });
  }

  // 按状态过滤
  if (filters.status) {
    query = query.where({ status: filters.status });
  }

  const res = await query.orderBy('date', 'asc')
    .orderBy('start_time', 'asc')
    .get();
  return res.data;
}

/**
 * 获取课程详情
 * @param {string} lessonId
 */
async function getLessonDetail(lessonId) {
  const res = await db.collection('lessons').doc(lessonId).get();
  return res.data;
}

/**
 * 创建课程（排课/约课）
 * @param {object} data - 课程信息
 */
async function createLesson(data) {
  return db.collection('lessons').add({
    data: {
      ...data,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date()
    }
  });
}

/**
 * 更新课程状态
 * @param {string} lessonId
 * @param {object} data
 */
async function updateLesson(lessonId, data) {
  return db.collection('lessons').doc(lessonId).update({
    data: { ...data, updated_at: new Date() }
  });
}

// ===== training_records 表操作 =====

/**
 * 获取训练记录
 * @param {string} lessonId
 */
async function getTrainingRecord(lessonId) {
  const res = await db.collection('training_records')
    .where({ lesson_id: lessonId })
    .get();
  return res.data[0] || null;
}

/**
 * 保存训练记录
 * @param {object} data
 */
async function saveTrainingRecord(data) {
  const app = getApp();
  return db.collection('training_records').add({
    data: {
      ...data,
      coach_openid: app.globalData.openid,
      created_at: new Date()
    }
  });
}

// ===== lesson_card_logs 表操作 =====

/**
 * 获取课时变动记录
 * @param {string} studentId
 */
async function getLessonCardLogs(studentId) {
  const res = await db.collection('lesson_card_logs')
    .where({ student_id: studentId })
    .orderBy('created_at', 'desc')
    .get();
  return res.data;
}

/**
 * 添加课时变动记录
 * @param {object} data
 */
async function addLessonCardLog(data) {
  return db.collection('lesson_card_logs').add({
    data: { ...data, created_at: new Date() }
  });
}

// ===== coach_settings 操作 =====

/**
 * 获取教练设置
 */
async function getCoachSettings() {
  const app = getApp();
  const res = await db.collection('coach_settings')
    .where({ openid: app.globalData.openid })
    .get();
  return res.data[0] || null;
}

/**
 * 保存/更新教练设置
 * @param {object} data
 */
async function saveCoachSettings(data) {
  const app = getApp();
  const existing = await getCoachSettings();

  if (existing) {
    return db.collection('coach_settings').doc(existing._id).update({
      data: { ...data, updated_at: new Date() }
    });
  } else {
    return db.collection('coach_settings').add({
      data: {
        ...data,
        openid: app.globalData.openid,
        created_at: new Date(),
        updated_at: new Date()
      }
    });
  }
}

// ===== 云存储 =====

/**
 * 上传图片到云存储
 * @param {string} filePath - 本地临时路径
 * @param {string} cloudPath - 云存储路径
 * @returns {Promise<string>} fileID
 */
async function uploadImage(filePath, cloudPath) {
  const res = await wx.cloud.uploadFile({
    cloudPath,
    filePath
  });
  return res.fileID;
}

/**
 * 删除云存储文件
 * @param {string|string[]} fileIDs
 */
async function deleteCloudFiles(fileIDs) {
  return wx.cloud.deleteFile({ fileList: [].concat(fileIDs) });
}

module.exports = {
  callCloud,
  getCurrentUser,
  bindUserRole,
  getStudents,
  getStudentDetail,
  addStudent,
  updateStudent,
  getLessons,
  getLessonDetail,
  createLesson,
  updateLesson,
  getTrainingRecord,
  saveTrainingRecord,
  getLessonCardLogs,
  addLessonCardLog,
  getCoachSettings,
  saveCoachSettings,
  uploadImage,
  deleteCloudFiles,
  _ // 数据库查询指令
};
