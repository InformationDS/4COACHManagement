const aiApi = require("../../../utils/aiApi");
const api = require("../../../utils/api");

function tabbar(page, selected) {
  if (typeof page.getTabBar === "function" && page.getTabBar()) {
    page.getTabBar().setData({ selected });
  }
}

let recordManager = null;

Page({
  data: {
    today: {
      todayLessonCount: 0,
      nextLesson: null,
      pendingSummaryCount: 0
    },
    messages: [
      {
        id: "welcome",
        role: "assistant",
        type: "answer",
        text: "你可以直接说：记录刚才这节课的训练内容，或安排下一节课。",
        created_at: Date.now()
      }
    ],
    inputText: "",
    sending: false,
    voiceState: "idle",
    voiceHint: "",
    scrollIntoView: "",
    quickActions: [
      { text: "记录训练", prompt: "我要记录刚才这节课的训练内容" },
      { text: "安排课程", prompt: "给学员安排一节课" },
      { text: "查今日课表", prompt: "我今天有哪些课？" },
      { text: "分析学员", prompt: "帮我看一个学员的基础情况" }
    ]
  },

  onLoad(options) {
    this.sourceContext = {
      source: options.source || "ai_home",
      student_id: options.student_id || "",
      lesson_id: options.lesson_id || ""
    };
    this.setupVoice();
    this.loadToday();
    this.loadPendingConfirmations();
  },

  appendMessage(message) {
    const messages = this.data.messages.concat(message);
    this.setData({
      messages,
      scrollIntoView: `msg-${messages.length - 1}`
    });
  },

  onShow() {
    tabbar(this, 0);
    const app = getApp();
    if (app.globalData && app.globalData.pendingAiSourceContext) {
      this.sourceContext = app.globalData.pendingAiSourceContext;
      app.globalData.pendingAiSourceContext = null;
      if (this.sourceContext.lesson_label) {
        this.setData({
          scrollIntoView: `msg-${this.data.messages.length}`,
          messages: this.data.messages.concat({
            id: `ctx_${Date.now()}`,
            role: "assistant",
            type: "answer",
            text: `正在为${this.sourceContext.lesson_label}处理，请说课后实际情况或训练方案要求。`,
            created_at: Date.now()
          })
        });
      }
    }
  },

  setupVoice() {
    try {
      if (typeof requirePlugin !== "function") {
        this.setData({ voiceHint: "语音转写暂不可用，请先使用文字输入" });
        return;
      }
      const plugin = requirePlugin("WechatSI");
      recordManager = plugin.getRecordRecognitionManager();
      recordManager.onStart = () => this.setData({ voiceState: "recording", voiceHint: "正在录音，上滑取消" });
      recordManager.onStop = (res) => {
        const text = res && res.result ? res.result : "";
        this.setData({
          voiceState: "idle",
          voiceHint: text ? "转写完成，可修改后发送" : "没有识别到内容",
          inputText: text || this.data.inputText
        });
      };
      recordManager.onError = () => {
        this.setData({ voiceState: "failed", voiceHint: "转写失败，可重试或改用文字输入" });
      };
    } catch (error) {
      console.warn("WechatSI plugin unavailable", error);
      this.setData({ voiceHint: "语音转写暂不可用，请先使用文字输入" });
    }
  },

  loadToday() {
    aiApi.getTodayContext()
      .then((res) => this.setData({ today: res.data || this.data.today }))
      .catch((err) => console.warn("getTodayContext failed", err));
  },

  loadPendingConfirmations() {
    aiApi.getPendingConfirmations()
      .then((res) => {
        const cards = (res.data || []).map((card) => ({
          id: card._id,
          role: "assistant",
          type: "confirm_card",
          text: "你还有一张待确认卡。",
          card,
          created_at: Date.now()
        }));
        if (cards.length) {
          this.setData({
            messages: this.data.messages.concat(cards),
            scrollIntoView: `msg-${this.data.messages.length + cards.length - 1}`
          });
        }
      })
      .catch((err) => console.warn("getPendingConfirmations failed", err));
  },

  onInput(event) {
    this.setData({ inputText: event.detail.value });
  },

  sendQuick(event) {
    const prompt = event.currentTarget.dataset.prompt;
    this.setData({ inputText: prompt });
    this.sendMessage();
  },

  sendMessage() {
    const text = (this.data.inputText || "").trim();
    if (!text || this.data.sending) return;

    const userMessage = {
      id: `local_${Date.now()}`,
      role: "user",
      type: "text",
      text,
      created_at: Date.now(),
      status: "done"
    };

    const userMessages = this.data.messages.concat(userMessage);
    this.setData({
      messages: userMessages,
      scrollIntoView: `msg-${userMessages.length - 1}`,
      inputText: "",
      sending: true,
      voiceHint: ""
    });

    aiApi.sendAiMessage({ text, inputType: "text", sourceContext: this.sourceContext })
      .then((res) => {
        const reply = {
          id: res.messageId || `ai_${Date.now()}`,
          role: "assistant",
          type: res.type,
          text: res.text || "",
          card: res.card || null,
          created_at: Date.now(),
          status: "done"
        };
        const nextMessages = this.data.messages.concat(reply);
        this.setData({
          messages: nextMessages,
          scrollIntoView: `msg-${nextMessages.length - 1}`,
          sending: false
        });
        this.sourceContext = { source: "ai_home" };
        this.loadToday();
      })
      .catch((err) => {
        this.setData({
          inputText: text,
          sending: false,
          scrollIntoView: `msg-${this.data.messages.length}`,
          messages: this.data.messages.concat({
            id: `err_${Date.now()}`,
            role: "assistant",
            type: "error",
            text: err.message || "AI 请求失败，文本已保留，可稍后重试。",
            created_at: Date.now()
          })
        });
      });
  },

  onTouchStart() {
    if (!recordManager) {
      wx.showToast({ title: "语音插件不可用", icon: "none" });
      return;
    }
    this.cancelVoice = false;
    this.voiceStartAt = Date.now();
    recordManager.start({ duration: 60000, lang: "zh_CN" });
  },

  onTouchMove(event) {
    const touch = event.touches && event.touches[0];
    if (touch && touch.clientY < 520) {
      this.cancelVoice = true;
      this.setData({ voiceHint: "松开取消录音" });
    }
  },

  onTouchEnd() {
    if (!recordManager) return;
    if (Date.now() - (this.voiceStartAt || 0) < 1000) {
      this.setData({ voiceState: "failed", voiceHint: "录音太短，请重新录音" });
    }
    recordManager.stop();
    if (this.cancelVoice) {
      this.setData({ voiceState: "idle", voiceHint: "已取消录音" });
    }
  },

  confirmCard(event) {
    const card = event.detail.card;
    if (!card || !card.confirmationId) return;
    wx.showLoading({ title: "执行中" });
    aiApi.executeAiAction({ confirmationId: card.confirmationId, userEdits: event.detail.userEdits || {} })
      .then((res) => {
        wx.hideLoading();
        const nextMessages = this.data.messages.concat({
            id: `result_${Date.now()}`,
            role: "assistant",
            type: "result_card",
            text: "",
            card: res.card,
            created_at: Date.now()
          });
        this.setData({
          messages: nextMessages,
          scrollIntoView: `msg-${nextMessages.length - 1}`
        });
        this.loadToday();
      })
      .catch((err) => {
        wx.hideLoading();
        api.toastError(err);
      });
  },

  cancelCard(event) {
    const card = event.detail.card;
    if (!card || !card.confirmationId) return;
    wx.showLoading({ title: "取消中" });
    aiApi.executeAiAction({ confirmationId: card.confirmationId, action: "cancel" })
      .then((res) => {
        wx.hideLoading();
        wx.showToast({ title: res.text || "已取消，未写入数据", icon: "none" });
      })
      .catch((err) => {
        wx.hideLoading();
        api.toastError(err);
      });
  }
});
