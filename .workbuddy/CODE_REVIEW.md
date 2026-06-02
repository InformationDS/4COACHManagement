# 私教助手小程序 - 代码审查与修复记录

> **审查日期**：2026-06-02
> **修复日期**：2026-06-02
> **审查范围**：PRD、实施计划、全部前端页面/组件、云函数、工具类
> **当前状态**：Phase 4 修复完成

---

## 修复清单（Phase 1-4 MVP 必修 + 应修）

### Step 1：极小改动速修 ✅

| # | 问题 | 修复内容 | 涉及文件 |
|---|------|----------|----------|
| S5 | confirmed 状态无法取消 | onCancel 条件改为 `pending || confirmed`，区分提示文案 | `student/lesson-detail.js` + `.wxml` |
| M1 | 日历缺少 completed 色点 | `_buildLessonMap` + `_getDayStatus` 添加 completed 映射，WXML 加色点，CSS 加绿色 | `calendar.js/.wxml/.wxss` |
| M7 | login-guide 已注册用户不跳转 | onLoad 检测 `app.globalData.ready && isRegistered()`，自动跳走 | `login-guide.js` |

### Step 2：数据流修复 ✅

| # | 问题 | 修复内容 | 涉及文件 |
|---|------|----------|----------|
| S3 | getCoachSettings 学员端查不到 | 函数签名改为 `getCoachSettings(coachOpenid)`，学员端传教练 openid | `api.js` + `booking.js` |
| S4 | 学员课程查询 student_id 可能缺失 | getLessons 学员端增加 `coach_openid + _openid` 组合查询兜底 | `api.js` |

### Step 3：学员绑定流程 ✅

| # | 问题 | 修复内容 | 涉及文件 |
|---|------|----------|----------|
| S2 | 学员绑定流程完全缺失 | 教练端学员详情页加"邀请学员绑定"按钮 + onShareAppMessage；login-guide 识别 student_id 参数展示绑定按钮 | `student-detail.js/.wxml` + `login-guide.js/.wxml` + `initUser/index.js` |

### Step 4：自定义 tabBar ✅

| # | 问题 | 修复内容 | 涉及文件 |
|---|------|----------|----------|
| S1 | 学员端 redirectTo 切页面体验差 | 改为微信自定义 tabBar (`"custom": true`)，按角色动态渲染 coachTabs/studentTabs | `app.json` + 新建 `custom-tab-bar/` + 6 个页面 onShow 设置 selected |

### Step 5：约课逻辑完善 ✅

| # | 问题 | 修复内容 | 涉及文件 |
|---|------|----------|----------|
| H2 | 约课不读教练 available_slots | booking.js loadData 从 settings 读取 start_time/end_time/lesson_duration | `booking.js` |
| H3 | 时间冲突检测缺失 | 提交前用区间重叠算法检测 `newStart < r.end && newEnd > r.start` | `booking.js` |

---

## 仍未修复（MVP 可延后）

| # | 问题 | 优先级 | 延后理由 |
|---|------|--------|----------|
| H1 | 课时事务保护 | 🟡 | 概率低 |
| H6 | 分享功能 | ✅ 已与 S2 合并完成 | - |
| H7 | blocked_times | 🟡 | 非核心 |
| M2 | last_lesson_date | 🟡 | 少一个字段 |
| M3 | 教练姓名硬编码 | 🟡 | 能接受 |
| M4 | searchTimer 在 data | 🟡 | 性能影响极小 |
| M5 | index.js 轮询 | 🟡 | 能工作 |
| M6 | 调试代码暴露 | 🔴 发布前必修 | MVP 阶段先忍 |
| M8 | api.js 模块级 db | 🟡 | 当前加载顺序 OK |
| M9 | 手机号校验 | 🟡 | 自行负责 |
| M10 | 教练信息编辑 | 🟡 | 非核心 |
