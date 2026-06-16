const { QUICK_ACTIONS, AI_RESPONSE_TYPES } = require('../../../utils/aiConstants');
const { getCardTheme, getConfirmButtonText, normalizeFields, buildRoute } = require('../../../utils/aiCards');
const {
  sendAiMessage,
  executeAiAction,
  getAiTodaySummary,
  getAiStatus,
  formatLocalDate
} = require('../../../utils/aiApi');

function createMessage(role, type, text, card) {
  return {
    id: `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    role,
    type,
    text: text || '',
    card: card || null,
    created_at: Date.now(),
    status: 'done'
  };
}

Page({
  data: {
    today: formatLocalDate(new Date()),
    loadingSummary: true,
    sending: false,
    executingId: '',
    inputText: '',
    quickActions: QUICK_ACTIONS,
    messages: [],
    summary: {
      total: 0,
      remaining: 0,
      completed: 0,
      missingRecords: 0,
      lowBalance: 0,
      nextText: '暂无待上课程'
    },
    aiStatus: {
      aiAvailable: true,
      voiceAvailable: false,
      message: ''
    }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(0);
    }
    this.loadStatus();
    this.loadTodaySummary();
  },

  onPullDownRefresh() {
    Promise.all([this.loadStatus(), this.loadTodaySummary()])
      .finally(() => wx.stopPullDownRefresh());
  },

  async loadStatus() {
    const status = await getAiStatus();
    this.setData({ aiStatus: status });
  },

  async loadTodaySummary() {
    this.setData({ loadingSummary: true });
    try {
      const res = await getAiTodaySummary();
      if (res && res.success) {
        this.setData({
          summary: {
            ...this.data.summary,
            ...(res.summary || {})
          }
        });
        if (this.data.messages.length === 0) {
          this.setData({
            messages: [this._normalizeAssistantMessage(res)]
          });
        }
      }
    } catch (err) {
      if (this.data.messages.length === 0) {
        this.setData({
          messages: [
            createMessage(
              'system',
              AI_RESPONSE_TYPES.ERROR,
              'AI 今日摘要暂时不可用，日程、学员和训练记录页面仍可正常使用。'
            )
          ]
        });
      }
    } finally {
      this.setData({ loadingSummary: false });
    }
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  onQuickAction(e) {
    const prompt = e.currentTarget.dataset.prompt;
    this.setData({ inputText: prompt || '' });
  },

  onVoiceTap() {
    wx.showModal({
      title: '语音暂未接入',
      content: '第一轮先跑通文本 AI 工作台。语音转写接入后，会把转写文本送入同一套确认卡流程。',
      showCancel: false
    });
  },

  async onSend() {
    const text = this.data.inputText.trim();
    if (!text || this.data.sending) return;

    const userMessage = createMessage('user', 'text', text);
    this.setData({
      messages: [...this.data.messages, userMessage],
      inputText: '',
      sending: true
    });

    try {
      const res = await sendAiMessage({
        text,
        sourceContext: { source: 'ai_home' }
      });
      const assistantMessage = this._normalizeAssistantMessage(res);
      const nextData = {
        messages: [...this.data.messages, assistantMessage]
      };
      if (res && res.summary) {
        nextData.summary = { ...this.data.summary, ...res.summary };
      }
      this.setData(nextData);
    } catch (err) {
      this.setData({
        messages: [
          ...this.data.messages,
          createMessage('assistant', AI_RESPONSE_TYPES.ERROR, 'AI 请求失败，请稍后重试，或回到传统页面手动处理。')
        ]
      });
    } finally {
      this.setData({ sending: false });
    }
  },

  _normalizeAssistantMessage(res) {
    if (!res || !res.success) {
      return createMessage('assistant', AI_RESPONSE_TYPES.ERROR, (res && res.error) || 'AI 未返回有效结果。');
    }
    const card = res.card ? this._normalizeCard(res.card) : null;
    return createMessage('assistant', res.type || AI_RESPONSE_TYPES.ANSWER, res.text, card);
  },

  _normalizeCard(card) {
    return {
      ...card,
      theme: getCardTheme(card.card_type),
      fields: normalizeFields(card.display_fields),
      primaryText: getConfirmButtonText(card.action_type),
      route: buildRoute(card)
    };
  },

  async onConfirmCard(e) {
    const confirmationId = e.currentTarget.dataset.id;
    if (!confirmationId || this.data.executingId) return;
    this.setData({ executingId: confirmationId });
    try {
      const res = await executeAiAction({ confirmationId });
      const card = res && res.card ? this._normalizeCard(res.card) : null;
      this.setData({
        messages: [
          ...this.data.messages,
          createMessage(
            'assistant',
            (res && res.type) || AI_RESPONSE_TYPES.RESULT_CARD,
            (res && res.text) || (res && res.message) || '操作已处理。',
            card
          )
        ]
      });
      if (res && res.success) {
        this.loadTodaySummary();
      }
    } catch (err) {
      this.setData({
        messages: [
          ...this.data.messages,
          createMessage('assistant', AI_RESPONSE_TYPES.ERROR, '确认执行失败，请返回传统页面检查数据后手动处理。')
        ]
      });
    } finally {
      this.setData({ executingId: '' });
    }
  },

  onCancelCard(e) {
    const confirmationId = e.currentTarget.dataset.id;
    const messages = this.data.messages.map(msg => {
      if (msg.card && msg.card.confirmation_id === confirmationId) {
        return {
          ...msg,
          card: { ...msg.card, local_cancelled: true }
        };
      }
      return msg;
    });
    this.setData({ messages });
  },

  onNavigateFromCard(e) {
    const route = e.currentTarget.dataset.route;
    if (!route) return;
    if (route.includes('/pages/coach/lessons/lessons')) {
      wx.switchTab({ url: route });
    } else {
      wx.navigateTo({ url: route });
    }
  }
});
