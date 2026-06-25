Component({
  properties: {
    card: {
      type: Object,
      value: null,
      observer(card) {
        this.initDraft(card);
      }
    },
    disabled: {
      type: Boolean,
      value: false
    }
  },

  data: {
    draft: {},
    lessonUnits: 1
  },

  lifetimes: {
    attached() {
      this.initDraft(this.properties.card);
    }
  },

  methods: {
    initDraft(card) {
      const payload = card && card.payload ? card.payload : {};
      const draft = {
        date: payload.date || "",
        start_time: payload.start_time || "",
        end_time: payload.end_time || "",
        location: payload.location || ""
      };
      this.setData({
        draft,
        lessonUnits: this.computeUnits(draft.start_time, draft.end_time, payload.lesson_units)
      });
    },

    computeUnits(startTime, endTime, fallbackUnits) {
      const start = this.timeToMinutes(startTime);
      const end = this.timeToMinutes(endTime);
      if (start === null || end === null || end <= start) return Number(fallbackUnits || this.data.lessonUnits || 1);
      const minutes = end - start;
      if (minutes <= 30) return 0.5;
      if (minutes <= 60) return 1;
      if (minutes <= 90) return 1.5;
      return 2;
    },

    timeToMinutes(value) {
      const parts = String(value || "").split(":").map(Number);
      if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
      return parts[0] * 60 + parts[1];
    },

    patchDraft(key, value) {
      const draft = Object.assign({}, this.data.draft, { [key]: value });
      const units = key === "start_time" || key === "end_time" ? this.computeUnits(draft.start_time, draft.end_time) : this.data.lessonUnits;
      this.setData({ draft, lessonUnits: units });
    },

    onDateChange(event) {
      this.patchDraft("date", event.detail.value);
    },

    onStartChange(event) {
      this.patchDraft("start_time", event.detail.value);
    },

    onEndChange(event) {
      this.patchDraft("end_time", event.detail.value);
    },

    onLocationInput(event) {
      this.patchDraft("location", event.detail.value);
    },

    onConfirm() {
      if (this.properties.disabled) return;
      const card = this.properties.card || {};
      const editableFields = card.editable_fields || [];
      const userEdits = {};
      editableFields.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(this.data.draft, key)) {
          userEdits[key] = this.data.draft[key];
        }
      });
      this.triggerEvent("confirm", { card, userEdits });
    },

    onCancel() {
      this.triggerEvent("cancel", { card: this.properties.card });
    }
  }
});
