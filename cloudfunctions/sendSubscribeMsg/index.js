// cloudfunctions/sendSubscribeMsg/index.js
// 发送微信订阅消息
// 需在微信公众平台申请模板后，替换 TEMPLATE_IDS 中的模板 ID

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

// 订阅消息模板 ID 映射
// TODO: 替换为你在微信公众平台申请的模板 ID
const TEMPLATE_IDS = {
  booking_notify: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // 约课通知
  confirm_notify: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // 确认通知
  cancel_notify: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',   // 取消通知
  training_record: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // 训练记录
  lesson_remind: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'    // 课程提醒 (V2)
};

/**
 * 发送订阅消息
 * @param {object} event
 * @param {string} event.scene - 场景: booking_notify | confirm_notify | cancel_notify | training_record
 * @param {string} event.toOpenid - 接收者 openid
 * @param {object} event.data - 模板数据
 */
exports.main = async (event, context) => {
  const { scene, toOpenid, data } = event;

  if (!scene || !toOpenid || !data) {
    return { success: false, message: '缺少必要参数: scene, toOpenid, data' };
  }

  const templateId = TEMPLATE_IDS[scene];
  if (!templateId) {
    return { success: false, message: `未知的订阅场景: ${scene}` };
  }

  try {
    const result = await cloud.openapi.subscribeMessage.send({
      touser: toOpenid,
      templateId: templateId,
      data: formatTemplateData(data, scene),
      // page: 点击消息后跳转的小程序页面
      page: data.page || ''
    });

    console.log('订阅消息发送成功:', result);
    return { success: true, result };
  } catch (err) {
    // 用户未订阅或频率限制等错误不视为失败
    if (err.errCode === 43101) {
      console.log('用户未订阅该消息');
      return { success: false, message: '用户未订阅' };
    }
    console.error('发送订阅消息失败:', err);
    return { success: false, message: err.message };
  }
};

/**
 * 格式化模板数据（根据场景适配字段）
 */
function formatTemplateData(data, scene) {
  // 通用字段映射 - 需根据实际申请的模板调整
  const common = {
    thing1: { value: data.thing1 || '' },      // 事项说明
    thing2: { value: data.thing2 || '' },      // 补充说明
    thing3: { value: data.thing3 || '' },      // 备注
    time4: { value: data.time4 || '' },        // 时间
    date5: { value: data.date5 || '' },        // 日期
    phrase6: { value: data.phrase6 || '' }     // 状态
  };
  return common;
}
