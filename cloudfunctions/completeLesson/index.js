const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function fail(error_code, error_message) {
  return { success: false, error_code, error_message };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail("NO_OPENID", "无法获取用户身份");
  const lessonId = event.lessonId;
  if (!lessonId) return fail("VALIDATION_FAILED", "缺少课程 ID");

  return db.runTransaction(async (transaction) => {
    const lesson = await transaction.collection("lessons").doc(lessonId).get();
    if (!lesson.data || lesson.data.coach_openid !== OPENID) return fail("NOT_OWNER", "无权操作该课程");
    if (lesson.data.status === "cancelled") return fail("LESSON_CANCELLED", "已取消课程不能完课");
    if (lesson.data.status === "completed") return fail("VALIDATION_FAILED", "课程已完成");

    const units = Number(lesson.data.lesson_units || 1);
    const student = await transaction.collection("students").doc(lesson.data.student_id).get();
    if (!student.data || student.data.coach_openid !== OPENID) return fail("STUDENT_NOT_FOUND", "学员不存在");
    if (Number(student.data.remaining_lessons || 0) < units) return fail("INSUFFICIENT_BALANCE", "当前剩余课时不足");

    await transaction.collection("lessons").doc(lessonId).update({
      data: { status: "completed", completed_at: db.serverDate(), updated_at: db.serverDate() }
    });
    await transaction.collection("students").doc(lesson.data.student_id).update({
      data: {
        remaining_lessons: _.inc(-units),
        last_lesson_date: lesson.data.date,
        updated_at: db.serverDate()
      }
    });
    await transaction.collection("lesson_balance_logs").add({
      data: {
        coach_openid: OPENID,
        student_id: lesson.data.student_id,
        lesson_id: lessonId,
        type: "complete_lesson",
        amount: -units,
        reason: "完课扣减",
        created_at: db.serverDate()
      }
    });

    return { success: true };
  });
};
