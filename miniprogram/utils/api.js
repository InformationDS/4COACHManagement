// utils/api.js - CloudBase data access for coach-only mode.
const db = wx.cloud.database();
const _ = db.command;

async function callCloud(name, data = {}) {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    return res.result;
  } catch (err) {
    console.error(`Cloud function [${name}] failed:`, err);
    throw err;
  }
}

// ===== users =====

async function getCurrentUser() {
  const app = getApp();
  const res = await db.collection('users')
    .where({ _openid: app.globalData.openid })
    .get();
  return res.data[0] || null;
}

async function bindUserRole(role, extra = {}) {
  return callCloud('initUser', { role, ...extra });
}

// ===== students managed by coach =====

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

async function getStudentDetail(studentId) {
  const res = await db.collection('students').doc(studentId).get();
  return res.data;
}

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

async function updateStudent(studentId, data) {
  return db.collection('students').doc(studentId).update({
    data: { ...data, updated_at: new Date() }
  });
}

// ===== lessons =====

async function getLessons(filters = {}) {
  const app = getApp();
  let query = db.collection('lessons')
    .where({ coach_openid: app.globalData.openid });

  if (filters.startDate && filters.endDate) {
    query = query.where({
      date: _.gte(filters.startDate).and(_.lte(filters.endDate))
    });
  }

  if (filters.status) {
    query = query.where({ status: filters.status });
  }

  const res = await query.orderBy('date', 'asc')
    .orderBy('start_time', 'asc')
    .limit(100)
    .get();
  return res.data;
}

async function getLessonDetail(lessonId) {
  const res = await db.collection('lessons').doc(lessonId).get();
  return res.data;
}

async function createLesson(data) {
  return db.collection('lessons').add({
    data: {
      ...data,
      status: data.status || 'pending',
      created_at: new Date(),
      updated_at: new Date()
    }
  });
}

async function updateLesson(lessonId, data) {
  return db.collection('lessons').doc(lessonId).update({
    data: { ...data, updated_at: new Date() }
  });
}

async function getStudentLessons(studentId, limit = 50) {
  const app = getApp();
  const res = await db.collection('lessons')
    .where({
      coach_openid: app.globalData.openid,
      student_id: studentId
    })
    .orderBy('date', 'desc')
    .orderBy('start_time', 'desc')
    .limit(limit)
    .get();
  return res.data;
}

async function completeLesson(lessonId) {
  return callCloud('completeLesson', { lessonId });
}

async function adjustLessonBalance(studentId, changeAmount, reason) {
  return callCloud('adjustLessonBalance', { studentId, changeAmount, reason });
}

// ===== training_records =====

async function getTrainingRecord(lessonId) {
  const res = await db.collection('training_records')
    .where({ lesson_id: lessonId })
    .get();
  return res.data[0] || null;
}

async function saveTrainingRecord(data) {
  const app = getApp();
  const existing = await getTrainingRecord(data.lesson_id);
  const recordData = {
    ...data,
    coach_openid: app.globalData.openid,
    updated_at: new Date()
  };

  if (existing && existing._id) {
    return db.collection('training_records').doc(existing._id).update({
      data: recordData
    });
  }

  return db.collection('training_records').add({
    data: {
      ...recordData,
      created_at: new Date()
    }
  });
}

// ===== lesson_card_logs =====

async function getLessonCardLogs(studentId) {
  const res = await db.collection('lesson_card_logs')
    .where({ student_id: studentId })
    .orderBy('created_at', 'desc')
    .get();
  return res.data;
}

// ===== coach_settings =====

async function getCoachSettings(coachOpenid) {
  const app = getApp();
  const targetOpenid = coachOpenid || app.globalData.openid;
  const res = await db.collection('coach_settings')
    .where({ openid: targetOpenid })
    .get();
  return res.data[0] || null;
}

async function saveCoachSettings(data) {
  const app = getApp();
  const existing = await getCoachSettings();

  if (existing) {
    return db.collection('coach_settings').doc(existing._id).update({
      data: { ...data, updated_at: new Date() }
    });
  }

  return db.collection('coach_settings').add({
    data: {
      ...data,
      openid: app.globalData.openid,
      created_at: new Date(),
      updated_at: new Date()
    }
  });
}

// ===== cloud storage =====

async function uploadImage(filePath, cloudPath) {
  const res = await wx.cloud.uploadFile({
    cloudPath,
    filePath
  });
  return res.fileID;
}

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
  completeLesson,
  adjustLessonBalance,
  getStudentLessons,
  getTrainingRecord,
  saveTrainingRecord,
  getLessonCardLogs,
  getCoachSettings,
  saveCoachSettings,
  uploadImage,
  deleteCloudFiles,
  _
};
