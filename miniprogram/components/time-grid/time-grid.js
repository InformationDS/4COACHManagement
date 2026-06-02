// components/time-grid/time-grid.js
const { generateTimeSlots } = require('../../utils/date');

Component({
  properties: {
    title: { type: String, value: '选择时间' },
    startTime: { type: String, value: '08:00' },
    endTime: { type: String, value: '18:00' },
    duration: { type: Number, value: 60 },
    occupied: { type: Array, value: [] },
    value: { type: String, value: '' },
    allowMulti: { type: Boolean, value: true }
  },

  data: {
    slotItems: [],
    selectedStart: '',
    selectedEnd: '',
    endTimes: [],
    slotIndexMap: {}
  },

  observers: {
    // 结构变化才重建格子
    'startTime,endTime,duration'() { this._build(); },
    // 占用变化只刷新 disabled 状态，不重置选择
    'occupied'() { this._refreshOccupied(); },
    'value'(val) { if (val) { const [s, e] = val.split('-'); this.setData({ selectedStart: s, selectedEnd: e || s }); this._applySelection(); } }
  },

  lifetimes: { attached() { this._build(); } },

  methods: {
    _build() {
      const { startTime, endTime, duration } = this.data;
      const times = generateTimeSlots(startTime, endTime, duration);
      const endTimes = [];
      const idxMap = {};
      const items = times.map((t, i) => {
        const [h, m] = t.split(':').map(Number);
        const endM = m + duration;
        const endH = h + Math.floor(endM / 60);
        const et = `${String(endH).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`;
        endTimes.push(et);
        idxMap[t] = i;
        return { value: t, endTime: et, disabled: false, active: false, rangeActive: false };
      });
      this.setData({ slotItems: items, endTimes, slotIndexMap: idxMap });
      this._applySelection();
    },

    // 仅刷新占用状态，不重置选择
    _refreshOccupied() {
      this._applySelection();
    },

    onTapSlot(e) {
      const time = e.currentTarget.dataset.time;
      const { slotIndexMap, allowMulti } = this.data;
      const occupied = this.data.occupied || this.properties.occupied || [];
      if (occupied.includes(time)) return;

      if (!this.data.selectedStart) {
        this.setData({ selectedStart: time, selectedEnd: time });
        this._applySelection();
        this._emit();
        return;
      }

      const idx = slotIndexMap[time];
      const startIdx = slotIndexMap[this.data.selectedStart];
      if (allowMulti && idx !== startIdx) {
        const min = Math.min(startIdx, idx);
        const max = Math.max(startIdx, idx);
        const times = this.data.slotItems.map(s => s.value);
        if (times.slice(min, max + 1).some(t => occupied.includes(t))) {
          wx.showToast({ title: '范围内有已占用时段', icon: 'none' });
          return;
        }
        this.setData({ selectedStart: times[min], selectedEnd: times[max] });
      } else {
        this.setData({ selectedStart: time, selectedEnd: time });
      }
      this._applySelection();
      this._emit();
    },

    _applySelection() {
      const { slotItems, selectedStart, selectedEnd, slotIndexMap } = this.data;
      const occupied = this.data.occupied || this.properties.occupied || [];
      if (!selectedStart || !slotItems.length) {
        this.setData({ slotItems: slotItems.map(s => ({ ...s, active: false, rangeActive: false, disabled: occupied.includes(s.value) })) });
        return;
      }
      const startI = slotIndexMap[selectedStart] ?? -1;
      const endI = slotIndexMap[selectedEnd] ?? startI;
      const min = Math.min(startI, endI);
      const max = Math.max(startI, endI);
      this.setData({
        slotItems: slotItems.map((s, i) => ({
          ...s,
          active: i === startI,
          rangeActive: i >= min && i <= max,
          disabled: occupied.includes(s.value)
        }))
      });
    },

    _emit() {
      const { selectedStart, selectedEnd, slotIndexMap, endTimes } = this.data;
      if (!selectedStart) return this.triggerEvent('change', { value: '', startTime: '', endTime: '', count: 0 });
      const endI = slotIndexMap[selectedEnd] ?? slotIndexMap[selectedStart];
      const end = endTimes[endI] ?? selectedEnd;
      const count = Math.abs(endI - (slotIndexMap[selectedStart] ?? 0)) + 1;
      this.triggerEvent('change', { value: `${selectedStart}-${end}`, startTime: selectedStart, endTime: end, count });
    },

    onClear() {
      this.setData({ selectedStart: '', selectedEnd: '' });
      this._applySelection();
      this._emit();
    }
  }
});
