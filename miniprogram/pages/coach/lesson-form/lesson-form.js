const api = require("../../../utils/api");
const date = require("../../../utils/date");

Page({
  data: {
    lessonId: "",
    students: [],
    studentIndex: -1,
    form: {
      student_id: "",
      date: date.formatDate(new Date()),
      start_time: "09:00",
      end_time: "10:00",
      location: "",
      lesson_units: 1,
      notes: "",
      training_theme: ""
    },
    unitOptions: ["0.5", "1", "1.5", "2"],
    unitIndex: 1
  },

  onLoad(options) {
    const updates = {};
    if (options.id) updates.lessonId = options.id;
    if (options.date) updates["form.date"] = options.date;
    this.setData(updates);
    this.loadStudents();
    if (options.id) this.loadLesson(options.id);
  },

  loadStudents() {
    api.getStudents("").then((res) => {
      this.setData({ students: res.data || [] });
    }).catch(api.toastError);
  },

  loadLesson(id) {
    api.getLesson(id).then((res) => {
      const lesson = res.data;
      this.setData({
        form: {
          student_id: lesson.student_id,
          date: lesson.date,
          start_time: lesson.start_time,
          end_time: lesson.end_time,
          location: lesson.location || "",
          lesson_units: lesson.lesson_units || 1,
          notes: lesson.notes || "",
          training_theme: lesson.training_plan && lesson.training_plan.theme ? lesson.training_plan.theme : ""
        }
      });
    }).catch(api.toastError);
  },

  pickStudent(event) {
    const index = Number(event.detail.value);
    const student = this.data.students[index];
    this.setData({
      studentIndex: index,
      "form.student_id": student ? student._id : "",
      "form.location": student && student.default_location ? student.default_location : this.data.form.location
    });
  },

  pickDate(event) {
    this.setData({ "form.date": event.detail.value });
  },

  pickStart(event) {
    this.setData({ "form.start_time": event.detail.value });
  },

  pickEnd(event) {
    this.setData({ "form.end_time": event.detail.value });
  },

  pickUnit(event) {
    const index = Number(event.detail.value);
    this.setData({ unitIndex: index, "form.lesson_units": Number(this.data.unitOptions[index]) });
  },

  inputField(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: event.detail.value });
  },

  save() {
    const payload = Object.assign({}, this.data.form, { lesson_id: this.data.lessonId });
    api.saveLesson(payload)
      .then((res) => {
        wx.showToast({ title: "已保存" });
        const id = res.data && res.data._id ? res.data._id : this.data.lessonId;
        setTimeout(() => wx.redirectTo({ url: `/pages/coach/lesson-detail/lesson-detail?id=${id}` }), 500);
      })
      .catch(api.toastError);
  }
});
