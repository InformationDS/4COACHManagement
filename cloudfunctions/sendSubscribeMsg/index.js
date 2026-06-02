// cloudfunctions/sendSubscribeMsg/index.js
// 发送微信订阅消息
// 需在微信公众平台申请模板后，替换 TEMPLATE_IDS 中的模板 ID

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// ===== 订阅消息模板 ID 映射 =====
// TODO: 替换为你在微信公众平台申请的模板 ID
// 申请路径: 小程序后台 → 功能 → 订阅消息 → 选用模板
// 建议模板关键词: 预约时间、预约事项、备注、状态
const TEMPLATE_IDS = {
  booking_notify: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // 约课通知 → 教练
  confirm_notify: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // 确认通知 → 学员
  cancel_notify:  'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // 取消通知 → 对方
  training_record: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'  // 训练记录 → 学员
};

/**
 * 发送订阅消息主入口
 * @param {object} event
 * @param {string} event.scene  - 场景标识
 * @param {string} event.toOpenid - 接收者 openid
 * @param {object} event.data   - 模板数据
 */
exports.main = async (event, context) => {
  const { scene, toOpenid, data } = event;

  // --- 参数校验 ---
  if (!scene || !toOpenid || !data) {
    console.warn('参数不完整:', { scene, toOpenid: !!toOpenid, data: !!data });
    return { success: false, message: '缺少必要参数: scene, toOpenid, data' };
  }

  const templateId = TEMPLATE_IDS[scene];
  if (!templateId) {
    console.warn('未知场景:', scene);
    return { success: false, message: `未知的订阅场景: ${scene}` };
  }

  // 模板 ID 还是占位符时，记录日志但不发送
  if (templateId === 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
    console.log(`[${scene}] 模板 ID 未配置，跳过发送 → to:${toOpenid.slice(-6)} data:`, JSON.stringify(data));
    return { success: false, message: '模板 ID 未配置' };
  }

  // --- 发送消息 ---
  try {
    const sendData = buildTemplateData(data, scene);

    const result = await cloud.openapi.subscribeMessage.send({
      touser: toOpenid,
      templateId: templateId,
      data: sendData,
      page: data.page || '',
      miniprogramState: 'formal' // formal(正式版) | trial(体验版) | developer(开发版)
    });

    console.log(`[${scene}] 发送成功 → to:${toOpenid.slice(-6)}`);
    return { success: true, result };
  } catch (err) {
    // 用户未订阅（errCode 43101）不视为错误，属于正常业务情况
    if (err.errCode === 43101) {
      console.log(`[${scene}] 用户未订阅 → to:${toOpenid.slice(-6)}`);
      return { success: false, message: '用户未订阅该消息模板' };
    }
    // 超出频率限制
    if (err.errCode === 45009) {
      console.warn(`[${scene}] 频率限制 → to:${toOpenid.slice(-6)}`);
      return { success: false, message: '订阅消息发送频率超限' };
    }
    console.error(`[${scene}] 发送失败:`, err);
    return { success: false, message: err.message || '发送失败' };
  }
};

/**
 * 构建模板数据（按微信订阅消息字段规范）
 *
 * 微信订阅消息 value 格式: { value: "内容" }
 * 通用字段说明:
 *   thing{N}  - 事物（最多20个汉字）
 *   date{N}   - 日期（如 "2026年6月2日"）
 *   time{N}   - 时间（如 "09:00"）
 *   phrase{N} - 状态（如 "已确认"）
 */
function buildTemplateData(data, scene) {
  // 使用通用字段名 thing1～thing5, date, time, phrase
  // 前端传入的 data 对象键名映射到模板变量
  const fields = {};

  // 遍历前端传入的数据，按微信格式包装
  Object.keys(data).forEach(key => {
    if (key === 'page' || data[key] === undefined || data[key] === null) return;
    fields[key] = { value: String(data[key]).substring(0, 20) };
  });

  // 兜底: 如果前端没传标准字段，使用默认映射
  if (Object.keys(fields).length === 0) {
    fields.thing1 = { value: data.thing1 || '课程通知' };
    fields.thing2 = { value: data.thing2 || '' };
    fields.time3  = { value: data.time3 || '' };
    fields.date4  = { value: data.date4 || '' };
    fields.phrase5 = { value: data.phrase5 || '' };
  }

  return fields;
}
