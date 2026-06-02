// utils/role.js - 角色判断工具

const app = getApp();

/**
 * 获取当前用户角色
 * @returns {'coach' | 'student' | 'unknown'}
 */
function getRole() {
  return app.getRole();
}

/**
 * 是否为教练
 */
function isCoach() {
  return app.getRole() === 'coach';
}

/**
 * 是否为学员
 */
function isStudent() {
  return app.getRole() === 'student';
}

/**
 * 是否已注册
 */
function isRegistered() {
  return app.isRegistered();
}

/**
 * 根据角色获取首页路径
 * @param {'coach' | 'student' | 'unknown'} role
 * @returns {string}
 */
function getHomePath(role) {
  const roleMap = {
    coach: '/pages/coach/lessons/lessons',
    student: '/pages/student/booking/booking',
    unknown: '/pages/common/login-guide/login-guide'
  };
  return roleMap[role] || roleMap.unknown;
}

/**
 * 角色中文名称
 * @param {'coach' | 'student' | 'unknown'} role
 * @returns {string}
 */
function getRoleName(role) {
  const nameMap = {
    coach: '教练',
    student: '学员',
    unknown: '未注册'
  };
  return nameMap[role] || '未知';
}

module.exports = {
  getRole,
  isCoach,
  isStudent,
  isRegistered,
  getHomePath,
  getRoleName
};
