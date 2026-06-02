// components/student-picker/student-picker.js
// 学员选择器 —— Phase 3 排课时使用

const { getStudents } = require('../../utils/api');

Component({
  properties: {
    // 标题
    title: {
      type: String,
      value: '选择学员'
    },
    // 已选中的学员 ID
    value: {
      type: String,
      value: ''
    }
  },

  data: {
    students: [],
    selectedId: '',
    loading: true
  },

  observers: {
    'value'(val) {
      this.setData({ selectedId: val });
    }
  },

  lifetimes: {
    attached() {
      this.loadStudents();
    }
  },

  methods: {
    async loadStudents() {
      this.setData({ loading: true });
      try {
        const students = await getStudents();
        this.setData({
          students,
          selectedId: this.data.value || this.data.selectedId,
          loading: false
        });
      } catch (err) {
        console.error('加载学员列表失败:', err);
        this.setData({ loading: false });
      }
    },

    onSelect(e) {
      const id = e.currentTarget.dataset.id;
      this.setData({ selectedId: id });
      this.triggerEvent('change', {
        value: id,
        student: this.data.students.find(s => s._id === id)
      });
    },

    // 外部刷新
    refresh() {
      this.loadStudents();
    }
  }
});
