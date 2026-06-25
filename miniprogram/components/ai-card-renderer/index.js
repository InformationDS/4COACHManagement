const aiCards = require("../../utils/aiCards");

Component({
  properties: {
    message: {
      type: Object,
      value: {}
    }
  },

  methods: {
    onConfirm(event) {
      this.triggerEvent("confirm", event.detail);
    },

    onCancel(event) {
      this.triggerEvent("cancel", event.detail);
    },

    openRoute() {
      const route = aiCards.resultRoute(this.properties.message.card);
      if (route) {
        wx.navigateTo({ url: route });
      }
    }
  }
});
