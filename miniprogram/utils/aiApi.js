const { callCloud } = require('./api');

function formatLocalDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildClientTime() {
  const now = new Date();
  return {
    iso: now.toISOString(),
    date: formatLocalDate(now),
    timezoneOffset: now.getTimezoneOffset()
  };
}

async function sendAiMessage({ text, inputType = 'text', sourceContext = {} }) {
  return callCloud('aiCoachAssistant', {
    text,
    inputType,
    sourceContext,
    clientTime: buildClientTime()
  });
}

async function executeAiAction({ confirmationId }) {
  return callCloud('aiActionExecutor', { confirmationId });
}

async function cancelAiAction({ confirmationId }) {
  return callCloud('aiActionExecutor', {
    action: 'cancel',
    confirmationId
  });
}

async function getAiTodaySummary() {
  return sendAiMessage({
    text: '今天怎么样？',
    sourceContext: {
      source: 'ai_home',
      intent: 'today_summary',
      silent: true
    }
  });
}

async function getAiStatus() {
  try {
    return await callCloud('aiCoachAssistant', { action: 'status' });
  } catch (err) {
    return {
      success: false,
      aiAvailable: false,
      modelConfigured: false,
      voiceAvailable: false,
      modelMode: 'unavailable',
      degradedReason: err.message || 'status_check_failed',
      message: 'AI 状态检查失败，传统页面仍可使用。'
    };
  }
}

module.exports = {
  sendAiMessage,
  executeAiAction,
  cancelAiAction,
  getAiTodaySummary,
  getAiStatus,
  formatLocalDate
};
