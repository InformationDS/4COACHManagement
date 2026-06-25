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
  const studentId = event.student_id;
  const rawAmount = Number(event.amount || 0);
  const type = event.type;
  if (!studentId || !rawAmount) return fail("VALIDATION_FAILED", "学员和课时数量不能为空");
  if (!["recharge", "manual_deduct"].includes(type)) return fail("VALIDATION_FAILED", "课时调整类型无效");
  const amount = type === "manual_deduct" ? -Math.abs(rawAmount) : Math.abs(rawAmount);

  return db.runTransaction(async (transaction) => {
    const student = await transaction.collection("students").doc(studentId).get();
    if (!student.data || student.data.coach_openid !== OPENID) return fail("NOT_OWNER", "无权操作该学员");
    const next = Number(student.data.remaining_lessons || 0) + amount;
    if (next < 0) return fail("INSUFFICIENT_BALANCE", "扣减后课时不能小于 0");
    await transaction.collection("students").doc(studentId).update({
      data: { remaining_lessons: _.inc(amount), updated_at: db.serverDate() }
    });
    await transaction.collection("lesson_balance_logs").add({
      data: {
        coach_openid: OPENID,
        student_id: studentId,
        type,
        amount,
        reason: event.reason || "",
        created_at: db.serverDate()
      }
    });
    return { success: true };
  });
};
