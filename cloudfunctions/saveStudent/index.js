const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function fail(error_code, error_message) {
  return { success: false, error_code, error_message };
}

async function ensureCoach(openid) {
  const res = await db.collection("users").where({ openid, role: "coach" }).limit(1).get();
  return !!res.data.length;
}

function normalizeStudent(row) {
  const remaining = Number(row.remaining_lessons || 0);
  return Object.assign({}, row, {
    remaining_lessons: remaining,
    last_lesson_date: row.last_lesson_date || "暂无",
    pending_summary_count: row.pending_summary_count || 0
  });
}

async function safeGet(promise, fallback, label) {
  try {
    return await promise;
  } catch (error) {
    console.warn(`${label || "database"} failed`, error);
    return fallback;
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail("NO_OPENID", "无法获取用户身份");
  if (!(await ensureCoach(OPENID))) return fail("NOT_COACH", "当前用户不是教练");

  const action = event.action || "list";

  if (action === "list") {
    const keyword = (event.keyword || "").trim();
    const where = { coach_openid: OPENID, status: _.neq("deleted") };
    if (keyword) where.name = db.RegExp({ regexp: keyword, options: "i" });
    const result = await db.collection("students").where(where).orderBy("updated_at", "desc").limit(100).get();
    return { success: true, data: result.data.map(normalizeStudent) };
  }

  if (action === "get") {
    const studentId = event.studentId;
    if (!studentId) return fail("VALIDATION_FAILED", "缺少学员 ID");
    const student = await db.collection("students").doc(studentId).get();
    if (!student.data || student.data.coach_openid !== OPENID) return fail("NOT_OWNER", "无权访问该学员");

    const lessons = await safeGet(db.collection("lessons").where({ coach_openid: OPENID, student_id: studentId }).orderBy("start_at", "desc").limit(50).get(), { data: [] }, "lessons");
    const summaries = await safeGet(db.collection("lesson_summaries").where({ coach_openid: OPENID, student_id: studentId }).orderBy("updated_at", "desc").limit(50).get(), { data: [] }, "lesson_summaries");
    const balanceLogs = await safeGet(db.collection("lesson_balance_logs").where({ coach_openid: OPENID, student_id: studentId }).orderBy("created_at", "desc").limit(50).get(), { data: [] }, "lesson_balance_logs");
    return {
      success: true,
      data: {
        student: normalizeStudent(student.data),
        lessons: lessons.data.map((item) => Object.assign(item, { status_text: statusText(item.status) })),
        summaries: summaries.data,
        balanceLogs: balanceLogs.data.map(formatBalanceLog)
      }
    };
  }

  if (action === "save") {
    const payload = event.payload || {};
    const name = (payload.name || "").trim();
    if (!name) return fail("VALIDATION_FAILED", "学员姓名不能为空");
    const data = {
      name,
      phone: payload.phone || "",
      remaining_lessons: Number(payload.remaining_lessons || 0),
      goal: payload.goal || "",
      injuries: payload.injuries || "",
      notes: payload.notes || "",
      default_location: payload.default_location || "",
      status: "active",
      updated_at: db.serverDate()
    };

    if (payload.student_id) {
      const current = await db.collection("students").doc(payload.student_id).get();
      if (!current.data || current.data.coach_openid !== OPENID) return fail("NOT_OWNER", "无权修改该学员");
      await db.collection("students").doc(payload.student_id).update({ data });
      return { success: true, data: Object.assign({ _id: payload.student_id }, data) };
    }

    data.coach_openid = OPENID;
    data.created_at = db.serverDate();
    const created = await db.collection("students").add({ data });
    return { success: true, data: Object.assign({ _id: created._id }, data) };
  }

  return fail("VALIDATION_FAILED", "未知操作");
};

function statusText(status) {
  return { confirmed: "已确认", completed: "已完成", cancelled: "已取消" }[status] || status;
}

function formatBalanceLog(item) {
  return Object.assign({}, item, {
    type_text: { recharge: "充值", manual_deduct: "手动扣减", complete_lesson: "完课扣减" }[item.type] || item.type
  });
}
