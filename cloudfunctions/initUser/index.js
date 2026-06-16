// cloudfunctions/initUser/index.js
// Coach-only user initialization.

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { role, name, phone } = event;

  if (role !== 'coach') {
    return { success: false, message: '当前版本仅支持教练身份' };
  }

  try {
    const existing = await db.collection('users')
      .where({ _openid: openid })
      .get();

    const now = new Date();
    if (existing.data.length > 0) {
      await db.collection('users').doc(existing.data[0]._id).update({
        data: {
          role: 'coach',
          name: name || '',
          phone: phone || '',
          updated_at: now
        }
      });
      return { success: true, message: '教练身份已更新', action: 'updated' };
    }

    await db.collection('users').add({
      data: {
        _openid: openid,
        role: 'coach',
        name: name || '',
        phone: phone || '',
        created_at: now,
        updated_at: now
      }
    });
    return { success: true, message: '教练注册成功', action: 'created' };
  } catch (err) {
    console.error('initUser error:', err);
    return { success: false, message: err.message || '服务端错误' };
  }
};
