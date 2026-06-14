// cloudfunctions/initUser/index.js
// 用户初始化：绑定教练角色

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { role, name, phone } = event;

  // 参数校验
  if (role !== 'coach') {
    return { success: false, message: '当前版本仅支持教练身份' };
  }

  try {
    // 检查是否已存在
    const existing = await db.collection('users')
      .where({ _openid: openid })
      .get();

    if (existing.data.length > 0) {
      // 更新已有记录
      await db.collection('users').doc(existing.data[0]._id).update({
        data: {
          role,
          student_id: student_id || '',
          name: name || '',
          phone: phone || '',
          updated_at: new Date()
        }
      });
      return { success: true, message: '角色已更新', action: 'updated' };
    }

    // 教练角色：直接注册
    if (role === 'coach') {
      await db.collection('users').add({
        data: {
          _openid: openid,
          role: 'coach',
          name: name || '',
          phone: phone || '',
          created_at: new Date(),
          updated_at: new Date()
        }
      });
      return { success: true, message: '教练注册成功', action: 'created' };
    }

    return { success: false, message: '角色绑定失败' };
  } catch (err) {
    console.error('initUser 错误:', err);
    return { success: false, message: err.message || '服务器错误' };
  }
};
