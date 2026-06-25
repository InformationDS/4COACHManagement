const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const VALID_UNITS = [0.5, 1, 1.5, 2];

function fail(error_code, error_message) {
  return { success: false, error_code, error_message };
}

async function ensureCoach(openid) {
  const res = await db.collection("users").where({ openid, role: "coach" }).limit(1).get();
  return !!res.data.length;
}

function statusText(status) {
  return { confirmed: "已确认", completed: "已完成", cancelled: "已取消" }[status] || status;
}

function decorateLesson(item) {
  return Object.assign({}, item, {
    status_text: statusText(item.status),
    summary_status: item.summary_status || "none"
  });
}

function parseDateTime(dateText, timeText) {
  const parts = String(dateText || "").split("-").map(Number);
  const time = String(timeText || "").split(":").map(Number);
  if (parts.length !== 3 || time.length < 2) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], time[0], time[1], 0, 0);
}

async function findConflict(openid, startAt, endAt, excludeId) {
  const res = await db.collection("lessons").where({
    coach_openid: openid,
    status: _.neq("cancelled"),
    start_at: _.lt(endAt),
    end_at: _.gt(startAt)
  }).limit(20).get();
  return res.data.find((item) => item._id !== excludeId);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail("NO_OPENID", "无法获取用户身份");
  if (!(await ensureCoach(OPENID))) return fail("NOT_COACH", "当前用户不是教练");

  const action = event.action || "listByRange";

  if (action === "listByRange") {
    const startAt = new Date(event.startAt);
    const endAt = new Date(event.endAt);
    const result = await db.collection("lessons").where({
      coach_openid: OPENID,
      start_at: _.gte(startAt).and(_.lte(endAt))
    }).orderBy("start_at", "asc").limit(200).get();
    return { success: true, data: result.data.map(decorateLesson) };
  }

  if (action === "get") {
    const lesson = await db.collection("lessons").doc(event.lessonId).get();
    if (!lesson.data || lesson.data.coach_openid !== OPENID) return fail("NOT_OWNER", "无权访问该课程");
    return { success: true, data: decorateLesson(lesson.data) };
  }

  if (action === "cancel") {
    const lesson = await db.collection("lessons").doc(event.lessonId).get();
    if (!lesson.data || lesson.data.coach_openid !== OPENID) return fail("NOT_OWNER", "无权取消该课程");
    if (lesson.data.status === "completed") return fail("VALIDATION_FAILED", "已完成课程不能取消");
    await db.collection("lessons").doc(event.lessonId).update({
      data: {
        status: "cancelled",
        cancel_reason: event.cancelReason || "",
        updated_at: db.serverDate()
      }
    });
    return { success: true };
  }

  if (action === "save") {
    const payload = event.payload || {};
    const studentId = payload.student_id;
    const student = studentId ? await db.collection("students").doc(studentId).get() : null;
    if (!student || !student.data || student.data.coach_openid !== OPENID) return fail("STUDENT_NOT_FOUND", "请选择有效学员");

    const lessonUnits = Number(payload.lesson_units || 1);
    if (!VALID_UNITS.includes(lessonUnits)) return fail("VALIDATION_FAILED", "消耗课时只能为 0.5、1、1.5、2");
    if (Number(student.data.remaining_lessons || 0) < lessonUnits) return fail("INSUFFICIENT_BALANCE", "学员剩余课时不足");

    const startAt = parseDateTime(payload.date, payload.start_time);
    const endAt = parseDateTime(payload.date, payload.end_time);
    if (!startAt || !endAt || endAt <= startAt) return fail("VALIDATION_FAILED", "结束时间必须晚于开始时间");

    const conflict = await findConflict(OPENID, startAt, endAt, payload.lesson_id);
    if (conflict) return fail("TIME_CONFLICT", "该时间段已有课程");

    const data = {
      coach_openid: OPENID,
      student_id: studentId,
      student_name: student.data.name,
      date: payload.date,
      start_time: payload.start_time,
      end_time: payload.end_time,
      start_at: startAt,
      end_at: endAt,
      location: payload.location || student.data.default_location || "",
      lesson_units: lessonUnits,
      notes: payload.notes || "",
      status: "confirmed",
      summary_status: payload.summary_status || "none",
      training_plan: payload.training_theme ? { theme: payload.training_theme } : (payload.training_plan || null),
      source: payload.source || "manual",
      updated_at: db.serverDate()
    };

    if (!data.location) return fail("VALIDATION_FAILED", "上课地点不能为空");

    if (payload.lesson_id) {
      const current = await db.collection("lessons").doc(payload.lesson_id).get();
      if (!current.data || current.data.coach_openid !== OPENID) return fail("NOT_OWNER", "无权修改该课程");
      await db.collection("lessons").doc(payload.lesson_id).update({ data });
      return { success: true, data: decorateLesson(Object.assign({ _id: payload.lesson_id }, data)) };
    }

    data.created_at = db.serverDate();
    const created = await db.collection("lessons").add({ data });
    return { success: true, data: decorateLesson(Object.assign({ _id: created._id }, data)) };
  }

  return fail("VALIDATION_FAILED", "未知操作");
};
