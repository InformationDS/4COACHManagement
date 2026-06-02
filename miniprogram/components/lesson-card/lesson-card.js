// components/lesson-card/lesson-card.js
Component({
  properties: {
    lesson: { type: Object, value: {} }
  },
  methods: {
    onTap() {
      this.triggerEvent('lessontap', { lesson: this.data.lesson });
    }
  }
});
