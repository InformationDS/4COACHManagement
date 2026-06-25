const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const DEFAULT_ACTIONS = [
  ["杠铃卧推", ["卧推", "平板卧推", "杠铃平板卧推"], "胸", "杠铃", "推"],
  ["哑铃卧推", ["哑铃平板卧推"], "胸", "哑铃", "推"],
  ["坐姿面拉", ["面拉", "坐姿绳索面拉"], "肩", "绳索", "拉"],
  ["绳索直臂下压", ["直臂下压"], "背", "绳索", "拉"],
  ["哑铃俯身飞鸟", ["俯身飞鸟"], "肩", "哑铃", "拉"],
  ["深蹲", ["杠铃深蹲"], "腿", "杠铃", "蹲"],
  ["罗马尼亚硬拉", ["罗马尼亚硬举"], "腿", "杠铃", "髋铰链"],
  ["平板支撑", ["平板"], "核心", "自重", "支撑"]
];

function fail(error_code, error_message) {
  return { success: false, error_code, error_message };
}

async function ensureCoach(openid) {
  const res = await db.collection("users").where({ openid, role: "coach" }).limit(1).get();
  return !!res.data.length;
}

function splitAliases(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

async function seedDefaults() {
  const existing = await db.collection("action_library").where({ coach_openid: "system", source: "system" }).limit(1).get();
  if (existing.data.length) return;
  for (const row of DEFAULT_ACTIONS) {
    await db.collection("action_library").add({
      data: {
        coach_openid: "system",
        canonical_name: row[0],
        aliases: row[1],
        body_part: row[2],
        equipment: row[3],
        movement_type: row[4],
        source: "system",
        status: "active",
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    });
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail("NO_OPENID", "无法获取用户身份");
  if (!(await ensureCoach(OPENID))) return fail("NOT_COACH", "当前用户不是教练");
  const action = event.action || "list";

  if (action === "list") {
    await seedDefaults();
    const keyword = (event.keyword || "").trim();
    const result = await db.collection("action_library").where({
      coach_openid: _.in([OPENID, "system"]),
      status: "active"
    }).orderBy("source", "asc").limit(200).get();
    let rows = result.data;
    if (keyword) {
      rows = rows.filter((item) => item.canonical_name.includes(keyword) || (item.aliases || []).some((alias) => alias.includes(keyword)));
    }
    return {
      success: true,
      data: rows.map((item) => Object.assign({}, item, { aliases_text: (item.aliases || []).join("、") }))
    };
  }

  if (action === "save") {
    const payload = event.payload || {};
    const canonicalName = (payload.canonical_name || "").trim();
    if (!canonicalName) return fail("VALIDATION_FAILED", "标准动作名称不能为空");
    const data = {
      coach_openid: OPENID,
      canonical_name: canonicalName,
      aliases: splitAliases(payload.aliases),
      body_part: payload.body_part || "其他",
      equipment: payload.equipment || "未指定",
      movement_type: payload.movement_type || "其他",
      notes: payload.notes || "",
      source: "custom",
      status: "active",
      updated_at: db.serverDate()
    };
    if (payload.action_id) {
      const current = await db.collection("action_library").doc(payload.action_id).get();
      if (!current.data || current.data.coach_openid !== OPENID || current.data.source !== "custom") return fail("NOT_OWNER", "只能编辑自己的自定义动作");
      await db.collection("action_library").doc(payload.action_id).update({ data });
      return { success: true };
    }
    data.created_at = db.serverDate();
    await db.collection("action_library").add({ data });
    return { success: true };
  }

  if (action === "deactivate") {
    const current = await db.collection("action_library").doc(event.actionId).get();
    if (!current.data || current.data.coach_openid !== OPENID || current.data.source !== "custom") return fail("NOT_OWNER", "只能停用自己的自定义动作");
    await db.collection("action_library").doc(event.actionId).update({ data: { status: "inactive", updated_at: db.serverDate() } });
    return { success: true };
  }

  return fail("VALIDATION_FAILED", "未知操作");
};
