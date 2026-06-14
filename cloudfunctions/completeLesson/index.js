// cloudfunctions/completeLesson/index.js
// 教练单人模式：完成课程、扣减课时、写课时日志保持一致

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const coachOpenid = wxContext.OPENID;
  const { lessonId } = event;

  if (!lessonId) {
    return { success: false, message: '缺少课程 ID' };
  }

  try {
    return await db.runTransaction(async (transaction) => {
      const lessonRes = await transaction.collection('lessons').doc(lessonId).get();
      const lesson = lessonRes.data;

      if (!lesson) {
        return { success: false, message: '课程不存在' };
      }
      if (lesson.coach_openid !== coachOpenid) {
        return { success: false, message: '无权操作该课程' };
      }
      if (lesson.status === 'completed') {
        return { success: true, message: '课程已完成', skipped: true };
      }
      if (lesson.status === 'cancelled') {
        return { success: false, message: '已取消课程不能完成' };
      }
      if (!lesson.student_id) {
        return { success: false, message: '课程缺少学员信息' };
      }

      const studentRes = await transaction.collection('students').doc(lesson.student_id).get();
      const student = studentRes.data;
      if (!student) {
        return { success: false, message: '学员不存在' };
      }
      if (student.coach_openid !== coachOpenid) {
        return { success: false, message: '无权操作该学员' };
      }

      const oldBalance = Number(student.remaining_lessons || 0);
      const newBalance = Math.max(0, oldBalance - 1);
      const now = new Date();

      await transaction.collection('lessons').doc(lessonId).update({
        data: {
          status: 'completed',
          completed_at: now,
          updated_at: now
        }
      });

      await transaction.collection('students').doc(lesson.student_id).update({
        data: {
          remaining_lessons: newBalance,
          last_lesson_date: lesson.date || '',
          updated_at: now
        }
      });

      await transaction.collection('lesson_card_logs').add({
        data: {
          student_id: lesson.student_id,
          coach_openid: coachOpenid,
          change_amount: -1,
          balance_after: newBalance,
          reason: '课程完成自动扣减',
          related_lesson_id: lessonId,
          created_at: now
        }
      });

      return {
        success: true,
        oldBalance,
        newBalance
      };
    });
  } catch (err) {
    console.error('completeLesson 错误:', err);
    return { success: false, message: err.message || '服务器错误' };
  }
};
