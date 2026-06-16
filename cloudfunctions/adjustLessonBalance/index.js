// cloudfunctions/adjustLessonBalance/index.js
// Coach-only lesson balance adjustment with transactional log writing.
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const coachOpenid = wxContext.OPENID;
  const { studentId, changeAmount, reason } = event;
  const amount = Number(changeAmount);

  if (!studentId) {
    return { success: false, message: '缺少学员 ID' };
  }
  if (!Number.isFinite(amount) || amount === 0) {
    return { success: false, message: '课时变动数量无效' };
  }

  try {
    return await db.runTransaction(async (transaction) => {
      const studentRes = await transaction.collection('students').doc(studentId).get();
      const student = studentRes.data;

      if (!student) {
        return { success: false, message: '学员不存在' };
      }
      if (student.coach_openid !== coachOpenid) {
        return { success: false, message: '无权操作该学员' };
      }

      const oldBalance = Number(student.remaining_lessons || 0);
      const newBalance = oldBalance + amount;
      if (newBalance < 0) {
        return { success: false, message: '扣减后课时不能为负数' };
      }

      const now = new Date();
      await transaction.collection('students').doc(studentId).update({
        data: {
          remaining_lessons: _.inc(amount),
          updated_at: now
        }
      });

      await transaction.collection('lesson_card_logs').add({
        data: {
          student_id: studentId,
          coach_openid: coachOpenid,
          change_amount: amount,
          balance_after: newBalance,
          reason: reason || (amount > 0 ? '课时充值' : '手动扣减'),
          created_at: now
        }
      });

      return {
        success: true,
        oldBalance,
        newBalance,
        changeAmount: amount
      };
    });
  } catch (err) {
    console.error('adjustLessonBalance error:', err);
    return { success: false, message: err.message || '服务端错误' };
  }
};
