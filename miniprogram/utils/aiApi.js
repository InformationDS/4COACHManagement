const { callFunction } = require("./api");

function sendAiMessage({ text, inputType, sourceContext }) {
  return callFunction("aiCoachAssistant", {
    text,
    inputType: inputType || "text",
    sourceContext: sourceContext || { source: "ai_home" },
    clientTime: new Date().toISOString()
  });
}

function executeAiAction({ confirmationId, userEdits, action }) {
  return callFunction("aiActionExecutor", {
    action: action || "confirm",
    confirmationId,
    userEdits: userEdits || {}
  });
}

function getTodayContext() {
  return callFunction("aiCoachAssistant", {
    action: "getTodayContext",
    clientTime: new Date().toISOString()
  });
}

function getPendingConfirmations() {
  return callFunction("aiCoachAssistant", {
    action: "getPendingConfirmations",
    clientTime: new Date().toISOString()
  });
}

module.exports = {
  sendAiMessage,
  executeAiAction,
  getTodayContext,
  getPendingConfirmations
};
