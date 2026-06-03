// pages/coach/training-record/training-record.js
// 训练记录录入 —— 语音/文本双入口 + AI 结构化解析 + 教练确认编辑

const { formatDate } = require('../../../utils/date');
const {
  getLessonDetail, getTrainingRecord, saveTrainingRecord
} = require('../../../utils/api');

const BODY_PARTS = ['胸部', '背部', '腿部', '肩部', '手臂', '核心', '有氧', '其他'];
const recorderManager = wx.getRecorderManager();

Page({
  data: {
    loading: true,
    lessonId: '',
    lesson: {},
    existingRecord: null,

    // 文字输入（语音录入结果或手动输入都汇集于此）
    textInput: '',
    rawText: '',

    // 录音状态
    recording: false,
    recordDuration: 0,
    _recordTimer: null,

    // 结构化数据
    bodyParts: [],
    bodyPartsMap: {},      // {'胸部':true, '背部':false,...} 给WXML做类名绑定
    allBodyParts: BODY_PARTS,
    exercises: [],
    notes: '',

    // AI 解析
    parsing: false,
    parseResult: null,
    parseError: '',
    degraded: false,

    saving: false
  },

  onLoad(options) {
    this._initRecorder();
    if (options.lesson_id) {
      this.setData({ lessonId: options.lesson_id });
      this.loadData(options.lesson_id);
    }
  },

  onUnload() {
    this._clearTimer();
  },

  /** 从部位数组重建选中映射 */
  _buildMap(parts) {
    const map = {};
    (parts || []).forEach(p => { map[p] = true; });
    return map;
  },

  async loadData(lessonId) {
    this.setData({ loading: true });
    try {
      const lesson = await getLessonDetail(lessonId);
      let existingRecord = null;
      try { existingRecord = await getTrainingRecord(lessonId); } catch (e) {}

      if (existingRecord) {
        this.setData({
          lesson, existingRecord,
          bodyParts: existingRecord.body_parts || [],
          bodyPartsMap: this._buildMap(existingRecord.body_parts),
          exercises: existingRecord.exercises || [],
          notes: existingRecord.notes || '',
          rawText: existingRecord.raw_voice_text || '',
          textInput: existingRecord.raw_voice_text || '',
          loading: false
        });
      } else {
        this.setData({ lesson, loading: false });
      }
    } catch (e) {
      console.error('加载失败:', e);
      wx.showToast({ title: '加载课程失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // ===== 录音 =====
  _initRecorder() {
    recorderManager.onStart(() => {
      this.setData({ recording: true, recordDuration: 0 });
      this._startTimer();
    });

    recorderManager.onStop((res) => {
      this._clearTimer();
      this.setData({ recording: false });
      if (res.duration < 800) {
        wx.showToast({ title: '录音太短', icon: 'none' });
        return;
      }
      // 语音识别暂不可用，提示用户口述内容后手动输入
      wx.showModal({
        title: '录音完成',
        content: '语音识别暂需手动输入。请根据刚才口述的内容，在下方文本框中输入训练内容，然后点击 AI 解析。',
        showCancel: false
      });
    });

    recorderManager.onError((err) => {
      this._clearTimer();
      this.setData({ recording: false });
      wx.showToast({ title: '录音失败', icon: 'none' });
    });
  },

  _startTimer() {
    this._clearTimer();
    this.data._recordTimer = setInterval(() => {
      this.setData({ recordDuration: this.data.recordDuration + 1 });
    }, 1000);
  },

  _clearTimer() {
    if (this.data._recordTimer) {
      clearInterval(this.data._recordTimer);
      this.data._recordTimer = null;
    }
  },

  onRecordStart() {
    recorderManager.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    });
  },

  onRecordStop() {
    if (this.data.recording) {
      recorderManager.stop();
    }
  },

  // ===== 文字输入 =====
  onTextInput(e) {
    this.setData({ textInput: e.detail.value });
  },

  // ===== AI 解析 =====
  async onParseWithAI() {
    const text = this.data.textInput.trim();
    if (!text) {
      wx.showToast({ title: '请先输入训练内容', icon: 'none' });
      return;
    }

    this.setData({ parsing: true, parseError: '', degraded: false, rawText: text });

    try {
      const lesson = this.data.lesson;
      const res = await wx.cloud.callFunction({
        name: 'parseTrainingRecord',
        data: {
          text,
          studentName: lesson.student_name || '学员',
          lessonDate: typeof lesson.date === 'string' ? lesson.date : formatDate(lesson.date)
        }
      });

      const result = res.result;
      if (result.success && result.data) {
        this.setData({
          parseResult: result.data,
          degraded: result.degraded || false,
          bodyParts: result.data.body_parts || [],
          bodyPartsMap: this._buildMap(result.data.body_parts),
          exercises: result.data.exercises && result.data.exercises.length > 0
            ? result.data.exercises
            : [{ name: '', sets: 0, reps: 0, weight: '' }],
          notes: result.data.notes || ''
        });
        wx.showToast({
          title: result.degraded ? 'AI 未配置，请手动填写' : '解析完成，请核对',
          icon: result.degraded ? 'none' : 'success'
        });
      } else {
        throw new Error(result.message || '解析失败');
      }
    } catch (err) {
      console.error('AI 解析失败:', err);
      // 判断是否为超时错误
      const isTimeout = err.message && err.message.includes('timed out');
      const errorMsg = isTimeout
        ? 'AI 解析超时（云函数默认 3s 不够），请将超时改为 30 秒后重试'
        : (err.message || '解析失败');

      this.setData({
        parseError: errorMsg,
        degraded: true,
        bodyParts: [],
        bodyPartsMap: {},
        exercises: [{ name: '', sets: 0, reps: 0, weight: '' }],
        notes: text
      });

      if (isTimeout) {
        wx.showModal({
          title: '超时提示',
          content: '云函数默认超时仅 3 秒，调用 AI 需要更长时间。请在云开发控制台将 parseTrainingRecord 的超时改为 20-30 秒，然后重试。',
          showCancel: false
        });
      } else {
        wx.showToast({ title: '解析失败，请手动填写', icon: 'none' });
      }
    }
    this.setData({ parsing: false });
  },

  // ===== 训练部位 =====
  onToggleBodyPart(e) {
    const part = e.currentTarget.dataset.part;
    let parts = [...this.data.bodyParts];
    const idx = parts.indexOf(part);
    idx > -1 ? parts.splice(idx, 1) : parts.push(part);
    this.setData({ bodyParts: parts, bodyPartsMap: this._buildMap(parts) });
  },

  // ===== 动作明细 =====
  onExerciseFieldChange(e) {
    const { index, field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const exercises = [...this.data.exercises];
    if (exercises[index]) {
      exercises[index][field] = field === 'sets' || field === 'reps' ? (parseInt(value) || 0) : value;
      this.setData({ exercises });
    }
  },

  onAddExercise() {
    this.setData({
      exercises: [...this.data.exercises, { name: '', sets: 0, reps: 0, weight: '' }]
    });
  },

  onRemoveExercise(e) {
    const exercises = [...this.data.exercises];
    exercises.splice(e.currentTarget.dataset.index, 1);
    this.setData({ exercises });
  },

  // ===== 备注 =====
  onNotesInput(e) {
    this.setData({ notes: e.detail.value });
  },

  // ===== 保存 =====
  async onSave() {
    const { lessonId, lesson, bodyParts, exercises, notes, rawText } = this.data;
    const validExercises = exercises.filter(ex => ex.name && ex.name.trim());
    if (bodyParts.length === 0 && validExercises.length === 0) {
      wx.showToast({ title: '请至少填写训练部位或动作', icon: 'none' });
      return;
    }

    const cleanExercises = validExercises.map(ex => ({
      name: ex.name.trim(),
      sets: parseInt(ex.sets) || 0,
      reps: parseInt(ex.reps) || 0,
      weight: (ex.weight || '').trim()
    }));

    this.setData({ saving: true });
    try {
      await saveTrainingRecord({
        lesson_id: lessonId,
        student_id: lesson.student_id,
        body_parts: bodyParts,
        exercises: cleanExercises,
        notes: notes.trim(),
        raw_voice_text: rawText
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      console.error('保存失败:', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
    this.setData({ saving: false });
  }
});
