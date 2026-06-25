function callFunction(name, data) {
  return wx.cloud.callFunction({ name, data: data || {} })
    .then((res) => {
      const result = res.result || {};
      if (!result.success) {
        const message = result.error_message || result.message || "操作失败";
        const error = new Error(message);
        error.code = result.error_code;
        error.result = result;
        throw error;
      }
      return result;
    })
    .catch((err) => {
      if (err && err.result) throw err;
      console.error(`${name} cloud function failed`, err);
      const error = new Error("服务暂不可用，请稍后重试或检查云函数/数据库集合是否已部署。");
      error.raw = err;
      throw error;
    });
}

function toastError(error) {
  wx.showToast({
    title: error && error.message ? error.message : "操作失败",
    icon: "none"
  });
}

module.exports = {
  callFunction,
  toastError,

  getOpenid() {
    return callFunction("getOpenid");
  },

  initUser(data) {
    return callFunction("initUser", data);
  },

  getStudents(keyword) {
    return callFunction("saveStudent", { action: "list", keyword: keyword || "" });
  },

  getStudent(studentId) {
    return callFunction("saveStudent", { action: "get", studentId });
  },

  saveStudent(payload) {
    return callFunction("saveStudent", { action: "save", payload });
  },

  adjustLessonBalance(payload) {
    return callFunction("adjustLessonBalance", payload);
  },

  getLessonsByRange(startAt, endAt) {
    return callFunction("saveLesson", {
      action: "listByRange",
      startAt,
      endAt
    });
  },

  getLesson(lessonId) {
    return callFunction("saveLesson", { action: "get", lessonId });
  },

  saveLesson(payload) {
    return callFunction("saveLesson", { action: "save", payload });
  },

  cancelLesson(lessonId, cancelReason) {
    return callFunction("saveLesson", { action: "cancel", lessonId, cancelReason });
  },

  completeLesson(lessonId) {
    return callFunction("completeLesson", { lessonId });
  },

  getActionLibrary(keyword) {
    return callFunction("saveActionLibraryItem", { action: "list", keyword: keyword || "" });
  },

  saveActionLibraryItem(payload) {
    return callFunction("saveActionLibraryItem", { action: "save", payload });
  },

  deactivateActionLibraryItem(actionId) {
    return callFunction("saveActionLibraryItem", { action: "deactivate", actionId });
  }
};
