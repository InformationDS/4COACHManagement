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
    // 学员查看自己的课程 — 优先 student_id，兜底用 coach_openid + 学员 openid
    const userInfo = app.globalData.userInfo;
    if (userInfo && userInfo.student_id) {
      query = query.where({ student_id: userInfo.student_id });
    } else if (userInfo && userInfo.coach_openid) {
      query = query.where({
        coach_openid: userInfo.coach_openid,
        _openid: app.globalData.openid
      });
    } else {
      query = query.where({ coach_openid: '' }); // 返回空结果
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
 * @param {string} coachOpenid - 教练 openid（学员端必须传入，教练端可不传）
 */
async function getCoachSettings(coachOpenid) {
  const app = getApp();
  const targetOpenid = coachOpenid || app.globalData.openid;
  const res = await db.collection('coach_settings')
    .where({ openid: targetOpenid })
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

// ===== 订阅消息 =====

/**
 * 发送订阅消息（通过云函数）
 * 通知失败不中断主流程，静默处理
 * @param {object} options
 * @param {string} options.scene - 场景: booking_notify | confirm_notify | cancel_notify | training_record
 * @param {string} options.toOpenid - 接收者 openid
 * @param {object} options.data - 模板数据 { thing1, thing2, time4, date5, phrase6, page }
 */
async function sendSubscribeMessage(options) {
  try {
    return await callCloud('sendSubscribeMsg', {
      scene: options.scene,
      toOpenid: options.toOpenid,
      data: options.data
    });
  } catch (err) {
    // 通知失败不中断主流程
    console.warn('发送订阅消息失败:', err);
    return { success: false };
  }
}

/**
 * 获取学员的 openid（教练端用于发送通知）
 * @param {string} studentId - 学员 _id
 * @returns {Promise<string|null>} openid 或 null
 */
async function getStudentOpenid(studentId) {
  try {
    const student = await getStudentDetail(studentId);
    return student.openid || null;
  } catch (e) {
    console.warn('获取学员 openid 失败:', e);
    return null;
  }
}

/**
 * 获取教练的 openid（学员端用于发送通知）
 * @param {string} coachOpenid - 教练 openid
 * @returns {Promise<string>} coach openid
 */
async function getCoachOpenid(coachOpenid) {
  return coachOpenid; // 教练 openid 即为通知目标
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
  sendSubscribeMessage,
  getStudentOpenid,
  getCoachOpenid,
  uploadImage,
  deleteCloudFiles,
  _ // 数据库查询指令
};
