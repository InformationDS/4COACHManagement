// cloudfunctions/getOpenid/index.js
// 获取当前用户的 openid

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  return {
    openid: cloud.getWXContext().OPENID
  };
};
