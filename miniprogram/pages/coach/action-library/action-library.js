const api = require("../../../utils/api");

Page({
  data: {
    keyword: "",
    actions: [],
    form: {
      canonical_name: "",
      aliases: "",
      body_part: "其他",
      equipment: "未指定",
      movement_type: "其他",
      notes: ""
    }
  },

  onLoad() {
    this.load();
  },

  onSearch(event) {
    this.setData({ keyword: event.detail.value });
    this.load();
  },

  load() {
    api.getActionLibrary(this.data.keyword)
      .then((res) => this.setData({ actions: res.data || [] }))
      .catch(api.toastError);
  },

  inputField(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: event.detail.value });
  },

  save() {
    api.saveActionLibraryItem(this.data.form)
      .then(() => {
        wx.showToast({ title: "已保存" });
        this.setData({ form: { canonical_name: "", aliases: "", body_part: "其他", equipment: "未指定", movement_type: "其他", notes: "" } });
        this.load();
      })
      .catch(api.toastError);
  }
});
