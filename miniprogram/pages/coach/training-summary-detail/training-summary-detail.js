Page({
  data: {
    summary: null
  },

  onLoad(options) {
    this.setData({
      summary: {
        title: options.title || "课程训练总结",
        body: "课程训练总结详情会由 AI 保存后从 lesson_summaries 集合读取。"
      }
    });
  }
});
