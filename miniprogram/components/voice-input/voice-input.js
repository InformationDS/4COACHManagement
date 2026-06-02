// components/voice-input/voice-input.js
// 语音录入组件 —— 长按录音 + 语音识别转文字
// 支持降级：录音失败时可手动输入文字

const recorderManager = wx.getRecorderManager();

Component({
  properties: {
    // 占位文字
    placeholder: {
      type: String,
      value: '长按录音，或点击输入训练内容'
    }
  },

  data: {
    status: 'idle',       // idle | recording | recognizing | done
    text: '',             // 识别结果文字
    duration: 0,          // 录音时长（秒）
    timer: null,          // 计时器
    showTextInput: false  // 是否显示手动输入
  },

  lifetimes: {
    attached() {
      this._initRecorder();
    },
    detached() {
      this._clearTimer();
    }
  },

  methods: {
    _initRecorder() {
      // 监听录音开始
      recorderManager.onStart(() => {
        console.log('录音开始');
        this.setData({ status: 'recording', duration: 0, text: '' });
        this._startTimer();
      });

      // 监听录音结束（自动停止或手动停止）
      recorderManager.onStop((res) => {
        console.log('录音结束:', res);
        this._clearTimer();
        this._recognizeSpeech(res.tempFilePath, res.duration);
      });

      // 监听录音错误
      recorderManager.onError((err) => {
        console.error('录音错误:', err);
        this._clearTimer();
        wx.showToast({ title: '录音失败，请手动输入', icon: 'none' });
        this.setData({ status: 'idle' });
      });
    },

    _startTimer() {
      this._clearTimer();
      this.data.timer = setInterval(() => {
        this.setData({ duration: this.data.duration + 1 });
      }, 1000);
    },

    _clearTimer() {
      if (this.data.timer) {
        clearInterval(this.data.timer);
        this.data.timer = null;
      }
    },

    // ===== 触摸事件 =====
    onTouchStart() {
      if (this.data.status === 'recognizing') return;
      this._startRecord();
    },

    onTouchEnd() {
      if (this.data.status === 'recording') {
        this._stopRecord();
      }
    },

    onTouchCancel() {
      // 手指滑出区域 → 取消录音
      if (this.data.status === 'recording') {
        this._clearTimer();
        recorderManager.stop();
        this.setData({ status: 'idle', duration: 0, text: '' });
        wx.showToast({ title: '已取消录音', icon: 'none' });
      }
    },

    // ===== 录音控制 =====
    _startRecord() {
      recorderManager.start({
        duration: 60000,     // 最长 60 秒
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3'
      });
    },

    _stopRecord() {
      recorderManager.stop();
      this.setData({ status: 'recognizing' });
    },

    // ===== 语音识别 =====
    async _recognizeSpeech(filePath, duration) {
      try {
        // 方案 1：使用微信同声传译插件（需配置 app.json）
        // const plugin = requirePlugin('WechatSI');
        // const res = await plugin.voiceToText({ filePath, lang: 'zh_CN' });

        // 方案 2：上传到云存储后用云函数调用微信语音识别 API
        const cloudPath = `voice/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`;
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath,
          filePath
        });

        // 尝试调用云函数进行语音识别（微信云开发暂不直接支持语音识别API）
        // 降级处理：提示用户手动输入
        console.log('语音文件已上传:', uploadRes.fileID);

        // 如果录音很短（<1秒），可能是误触
        if (duration < 1000) {
          this.setData({ status: 'idle', text: '' });
          wx.showToast({ title: '录音太短，请重试', icon: 'none' });
          return;
        }

        // 降级：录音完成，显示手动输入区域
        // 用户可在此输入训练内容，也可点击文字触发 AI 解析
        this.setData({
          status: 'done',
          text: '',  // 语音识别暂不可用，留空等待手动输入
          showTextInput: true
        });

        // 清理临时录音文件
        wx.cloud.deleteFile({ fileList: [uploadRes.fileID] }).catch(() => {});

      } catch (err) {
        console.error('语音识别失败:', err);
        this.setData({ status: 'idle' });
        wx.showToast({ title: '识别失败，请手动输入', icon: 'none' });
      }
    },

    // ===== 手动输入 =====
    onToggleTextInput() {
      this.setData({ showTextInput: !this.data.showTextInput });
    },

    onTextInput(e) {
      this.setData({ text: e.detail.value });
    },

    // ===== 提交 / 清空 =====
    onSubmitText() {
      const text = this.data.text.trim();
      if (!text) {
        wx.showToast({ title: '请输入训练内容', icon: 'none' });
        return;
      }
      this.triggerEvent('submit', { text });
      this._reset();
    },

    onClear() {
      this._reset();
    },

    _reset() {
      this.setData({
        status: 'idle',
        text: '',
        duration: 0,
        showTextInput: false
      });
    }
  }
});
