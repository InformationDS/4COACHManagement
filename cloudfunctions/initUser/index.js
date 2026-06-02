// cloudfunctions/initUser/index.js
// 用户初始化：绑定角色（教练或学员）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { role, student_id, coach_openid, name, phone } = event;

  // 参数校验
  if (!role || !['coach', 'student'].includes(role)) {
    return { success: false, message: '角色参数无效，必须为 coach 或 student' };
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

    // 学员角色：需要关联 student_id
    if (role === 'student') {
      if (!student_id) {
        return { success: false, message: '学员注册需要提供 student_id' };
      }

      // 验证 student_id 存在
      const student = await db.collection('students').doc(student_id).get();
      if (!student.data) {
        return { success: false, message: '学员档案不存在' };
      }

      await db.collection('users').add({
        data: {
          _openid: openid,
          role: 'student',
          student_id,
          coach_openid: coach_openid || '',
          name: student.data.name,
          phone: student.data.phone || '',
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      // 同时更新 students 表的 openid
      await db.collection('students').doc(student_id).update({
        data: { openid, updated_at: new Date() }
      });

      return { success: true, message: '学员绑定成功', action: 'created' };
    }
  } catch (err) {
    console.error('initUser 错误:', err);
    return { success: false, message: err.message || '服务器错误' };
  }
};
