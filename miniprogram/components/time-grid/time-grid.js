// components/time-grid/time-grid.js
const { generateTimeSlots } = require('../../utils/date');

function timeToMinutes(time) {
  const [h, m] = String(time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function overlaps(start, end, range) {
  if (!range || !range.start || !range.end) return false;
  return start < range.end && end > range.start;
}

Component({
  properties: {
    title: { type: String, value: '选择开始时间' },
    startTime: { type: String, value: '06:00' },
    endTime: { type: String, value: '23:00' },
    duration: { type: Number, value: 60 },
    slotInterval: { type: Number, value: 15 },
    occupied: { type: Array, value: [] },
    occupiedRanges: { type: Array, value: [] },
    value: { type: String, value: '' }
  },

  data: {
    slotItems: [],
    selectedStart: '',
    selectedEnd: '',
    slotIndexMap: {}
  },

  observers: {
    'startTime,endTime,duration,slotInterval'() {
      this._build();
    },
    'occupied,occupiedRanges'() {
      this._applySelection();
    },
    value(val) {
      if (!val) {
        this.setData({ selectedStart: '', selectedEnd: '' });
        this._applySelection();
        return;
      }
      const [start, end] = val.split('-');
      this.setData({ selectedStart: start, selectedEnd: end || '' });
      this._applySelection();
    }
  },

  lifetimes: {
    attached() {
      this._build();
    }
  },

  methods: {
    _build() {
      const { startTime, endTime, duration, slotInterval } = this.data;
      const maxEnd = timeToMinutes(endTime);
      const idxMap = {};
      const items = generateTimeSlots(startTime, endTime, slotInterval || 15)
        .map((time) => {
          const startM = timeToMinutes(time);
          const endM = startM + duration;
          return { value: time, endTime: minutesToTime(endM), endM };
        })
        .filter(item => item.endM <= maxEnd)
        .map((item, index) => {
          idxMap[item.value] = index;
          return {
            value: item.value,
            endTime: item.endTime,
            active: false,
            rangeActive: false,
            disabled: false
          };
        });

      this.setData({ slotItems: items, slotIndexMap: idxMap });
      this._applySelection();
    },

    onTapSlot(e) {
      const time = e.currentTarget.dataset.time;
      const item = this.data.slotItems.find(slot => slot.value === time);
      if (!item || item.disabled) return;

      this.setData({ selectedStart: item.value, selectedEnd: item.endTime });
      this._applySelection();
      this._emit();
    },

    _applySelection() {
      const occupied = this.data.occupied || [];
      const occupiedRanges = this.data.occupiedRanges || [];
      const selectedStart = this.data.selectedStart;
      const slotItems = this.data.slotItems.map(slot => ({
        ...slot,
        active: slot.value === selectedStart,
        rangeActive: false,
        disabled: occupied.includes(slot.value) || occupiedRanges.some(range => overlaps(slot.value, slot.endTime, range))
      }));

      this.setData({ slotItems });
    },

    _emit() {
      const { selectedStart, selectedEnd } = this.data;
      if (!selectedStart) {
        this.triggerEvent('change', { value: '', startTime: '', endTime: '', count: 0 });
        return;
      }
      this.triggerEvent('change', {
        value: `${selectedStart}-${selectedEnd}`,
        startTime: selectedStart,
        endTime: selectedEnd,
        count: 1
      });
    },

    onClear() {
      this.setData({ selectedStart: '', selectedEnd: '' });
      this._applySelection();
      this._emit();
    }
  }
});
