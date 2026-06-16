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

async function getAiTodaySummary() {
  return sendAiMessage({
    text: '今天怎么样？',
    sourceContext: {
      source: 'ai_home',
      intent: 'today_summary'
    }
  });
}

async function getAiStatus() {
  return {
    success: true,
    aiAvailable: true,
    voiceAvailable: false,
    modelMode: 'cloud-function-openai-compatible',
    message: 'AI 文本能力通过云函数提供；语音转写暂未接入。'
  };
}

module.exports = {
  sendAiMessage,
  executeAiAction,
  getAiTodaySummary,
  getAiStatus,
  formatLocalDate
};
