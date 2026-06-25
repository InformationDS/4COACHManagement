const api = require("../../../utils/api");

Page({
  data: {
    studentId: "",
    tab: "overview",
    form: {
      name: "",
      phone: "",
      remaining_lessons: 0,
      goal: "",
      injuries: "",
      notes: "",
      default_location: ""
    },
    lessons: [],
    summaries: [],
    balanceLogs: [],
    balanceAmount: "",
    balanceReason: ""
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ studentId: options.id });
      this.load(options.id);
    }
  },

  load(id) {
    api.getStudent(id)
      .then((res) => {
        const data = res.data || {};
        this.setData({
          form: Object.assign({}, this.data.form, data.student || {}),
          lessons: data.lessons || [],
          summaries: data.summaries || [],
          balanceLogs: data.balanceLogs || []
        });
      })
      .catch(api.toastError);
  },

  switchTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab });
  },

  inputField(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: event.detail.value });
  },

  save() {
    const payload = Object.assign({}, this.data.form, { student_id: this.data.studentId });
    api.saveStudent(payload)
      .then((res) => {
        wx.showToast({ title: "已保存" });
        if (!this.data.studentId && res.data && res.data._id) {
          this.setData({ studentId: res.data._id });
        }
      })
      .catch(api.toastError);
  },

  inputBalanceAmount(event) {
    this.setData({ balanceAmount: event.detail.value });
  },

  inputBalanceReason(event) {
    this.setData({ balanceReason: event.detail.value });
  },

  adjustBalance(event) {
    const type = event.currentTarget.dataset.type;
    const amount = Number(this.data.balanceAmount);
    if (!this.data.studentId || !amount) {
      wx.showToast({ title: "请填写课时数量", icon: "none" });
      return;
    }
    api.adjustLessonBalance({
      student_id: this.data.studentId,
      type,
      amount,
      reason: this.data.balanceReason
    })
      .then(() => {
        wx.showToast({ title: "已更新" });
        this.setData({ balanceAmount: "", balanceReason: "" });
        this.load(this.data.studentId);
      })
      .catch(api.toastError);
  }
});
