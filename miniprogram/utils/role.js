// utils/role.js - coach-only role helpers

const app = getApp();

function getRole() {
  return app.getRole();
}

function isCoach() {
  return app.getRole() === 'coach';
}

function isRegistered() {
  return app.isRegistered();
}

function getHomePath(role) {
  const roleMap = {
    coach: '/pages/coach/ai-assistant/ai-assistant',
    unknown: '/pages/common/login-guide/login-guide'
  };
  return roleMap[role] || roleMap.unknown;
}

function getRoleName(role) {
  const nameMap = {
    coach: '教练',
    unknown: '未注册'
  };
  return nameMap[role] || '未知';
}

function navigateToHome(role) {
  const path = getHomePath(role);
  if (path.includes('login-guide')) {
    wx.redirectTo({ url: path });
  } else {
    wx.switchTab({ url: path });
  }
}

module.exports = {
  getRole,
  isCoach,
  isRegistered,
  getHomePath,
  getRoleName,
  navigateToHome
};
