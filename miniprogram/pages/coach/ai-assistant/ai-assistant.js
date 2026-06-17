const { QUICK_ACTIONS, AI_RESPONSE_TYPES } = require('../../../utils/aiConstants');
const { getCardTheme, getConfirmButtonText, normalizeFields, buildRoute } = require('../../../utils/aiCards');
const {
  sendAiMessage,
  executeAiAction,
  cancelAiAction,
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

function isSameText(a, b) {
  const left = String(a || '').replace(/\s+/g, '');
  const right = String(b || '').replace(/\s+/g, '');
  return !!left && left === right;
}

function shouldUsePendingContext(text, pendingContext) {
  if (!pendingContext || !pendingContext.intent) return false;
  const value = String(text || '');
  if (pendingContext.intent === 'create_lesson') {
    return !/(今天|今日|日程|记录|训练|低课时|未写|缺记录|复盘|取消|备注)/.test(value);
  }
  if (pendingContext.intent === 'create_training_record') {
    return !/(今天.*课|今日.*课|日程|排.*课|约.*课|安排.*课|低课时|未写|缺记录|复盘|取消|备注|最近.*练|练得怎么样|训练情况|分析|查询|某个学员|哪位学员)/.test(value);
  }
  return value.replace(/\s+/g, '').length <= 16;
}

Page({
  data: {
    today: formatLocalDate(new Date()),
    loadingSummary: true,
    sending: false,
    executingId: '',
    inputText: '',
    pendingContext: null,
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
      aiAvailable: false,
      modelConfigured: false,
      voiceAvailable: false,
      degradedReason: '',
      message: ''
    }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setSelected(0);
    }
    this.loadStatus();
    this.loadTodaySummary();
    this.consumePendingAiRequest();
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
    if (!prompt || this.data.sending) return;
    this.setData({ inputText: prompt });
    this.sendText(prompt, {
      source: 'ai_home_quick_action',
      quick_action: e.currentTarget.dataset.id || ''
    });
  },

  consumePendingAiRequest() {
    const app = getApp();
    const pending = app.globalData.pendingAiRequest;
    if (!pending || !pending.text) return;
    app.globalData.pendingAiRequest = null;
    this.setData({ inputText: pending.text });
    this.sendText(pending.text, pending.sourceContext || {});
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
    await this.sendText(text, { source: 'ai_home' });
  },

  async sendText(text, sourceContext) {
    if (!text || this.data.sending) return;

    const pendingContext = this.data.pendingContext;
    const effectiveSourceContext = {
      ...(sourceContext || { source: 'ai_home' })
    };
    if (shouldUsePendingContext(text, pendingContext) && !effectiveSourceContext.intent) {
      Object.assign(effectiveSourceContext, pendingContext);
      effectiveSourceContext.previous_input = pendingContext.previous_input;
      effectiveSourceContext.source = 'ai_home_followup';
    }

    const userMessage = createMessage('user', 'text', text);
    this.setData({
      messages: [...this.data.messages, userMessage],
      inputText: '',
      sending: true
    });

    try {
      const res = await sendAiMessage({
        text,
        sourceContext: effectiveSourceContext
      });
      const assistantMessage = this._normalizeAssistantMessage(res);
      const nextData = {
        messages: [...this.data.messages, assistantMessage],
        pendingContext: this._buildPendingContext(res, text, effectiveSourceContext)
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
    const text = card && isSameText(res.text, card.summary) ? '' : res.text;
    return createMessage('assistant', res.type || AI_RESPONSE_TYPES.ANSWER, text, card);
  },

  _normalizeCard(card) {
    return {
      ...card,
      theme: getCardTheme(card.card_type),
      fields: normalizeFields(card.display_fields),
      options: Array.isArray(card.options)
        ? card.options.map((option, index) => ({
          ...option,
          id: option.id || String(index),
          label: option.label || '选择'
        }))
        : [],
      primaryText: getConfirmButtonText(card.action_type),
      route: buildRoute(card)
    };
  },

  _buildPendingContext(res, text, sourceContext) {
    if (!res || res.type !== AI_RESPONSE_TYPES.FOLLOWUP || !res.intent || res.intent === 'unknown') {
      return null;
    }
    return {
      ...(sourceContext || {}),
      intent: res.intent,
      previous_input: sourceContext && sourceContext.previous_input
        ? `${sourceContext.previous_input} ${text}`
        : text
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

  async onChoiceOption(e) {
    const messageId = e.currentTarget.dataset.messageId;
    const optionIndex = Number(e.currentTarget.dataset.optionIndex);
    const message = this.data.messages.find(item => item.id === messageId);
    const option = message && message.card && message.card.options
      ? message.card.options[optionIndex]
      : null;
    if (!option || this.data.sending) return;

    const messages = this.data.messages.map(msg => {
      if (msg.id === messageId && msg.card) {
        return {
          ...msg,
          card: { ...msg.card, local_selected: option.id || option.label }
        };
      }
      return msg;
    });
    this.setData({ messages });
    await this.sendText(option.text || option.prompt || option.label, option.source_context || {});
  },

  async onCancelCard(e) {
    const confirmationId = e.currentTarget.dataset.id;
    if (!confirmationId || this.data.executingId) return;
    this.setData({ executingId: confirmationId });
    try {
      const res = await cancelAiAction({ confirmationId });
      if (!res || !res.success) {
        wx.showToast({ title: (res && res.message) || '取消失败', icon: 'none' });
        return;
      }
    } catch (err) {
      wx.showToast({ title: '取消失败', icon: 'none' });
      return;
    } finally {
      this.setData({ executingId: '' });
    }
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
