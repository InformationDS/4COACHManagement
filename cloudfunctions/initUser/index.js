const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function getOrCreateUser(openid) {
  const users = await db.collection("users").where({ openid }).limit(1).get();
  if (users.data.length) return users.data[0];

  const now = db.serverDate();
  const user = {
    openid,
    role: "coach",
    nick_name: "私人教练",
    created_at: now,
    updated_at: now
  };
  const created = await db.collection("users").add({ data: user });
  return Object.assign({ _id: created._id }, user);
}

async function getOrCreateSettings(openid) {
  const result = await db.collection("coach_settings").where({ coach_openid: openid }).limit(1).get();
  if (result.data.length) return result.data[0];

  const data = {
    coach_openid: openid,
    timezone: "Australia/Sydney",
    default_lesson_duration: 60,
    created_at: db.serverDate(),
    updated_at: db.serverDate()
  };
  const created = await db.collection("coach_settings").add({ data });
  return Object.assign({ _id: created._id }, data);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { success: false, error_code: "NO_OPENID", error_message: "无法获取用户身份" };

  const action = event.action || "init";
  const user = await getOrCreateUser(OPENID);

  if (action === "saveSettings") {
    const settings = event.settings || {};
    const current = await getOrCreateSettings(OPENID);
    await db.collection("coach_settings").doc(current._id).update({
      data: {
        default_lesson_duration: Number(settings.default_lesson_duration) || 60,
        updated_at: db.serverDate()
      }
    });
  }

  if (action === "feedback") {
    const content = (event.content || "").trim();
    if (!content) return { success: false, error_code: "VALIDATION_FAILED", error_message: "反馈内容不能为空" };
    await db.collection("feedback").add({
      data: {
        coach_openid: OPENID,
        content,
        created_at: db.serverDate()
      }
    });
  }

  const settings = await getOrCreateSettings(OPENID);
  return {
    success: true,
    user,
    settings
  };
};
