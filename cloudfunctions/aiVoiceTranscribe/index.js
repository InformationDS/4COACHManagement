exports.main = async () => {
  return {
    success: false,
    error_code: "VOICE_BACKEND_NOT_ENABLED",
    error_message: "第一版语音转写使用小程序同声传译插件，后端转写仅预留。"
  };
};
