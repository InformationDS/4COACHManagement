# Phase 5: 双向约课闭环 & 订阅消息 — 完成总结

> **日期**：2026-06-02 | **目标**：做出可用产品（非完整，但可用）

---

## 修改文件一览（7 个文件）

| # | 文件 | 改动类型 | 关键变更 |
|---|------|---------|---------|
| 1 | `miniprogram/utils/api.js` | 增强 | 新增 `sendSubscribeMessage`、`getStudentOpenid`、`getCoachOpenid` |
| 2 | `cloudfunctions/sendSubscribeMsg/index.js` | 重构 | 优化 `buildTemplateData`、区分 errCode 处理、占位符静默降级 |
| 3 | `miniprogram/pages/coach/lessons/lessons.js` | 增强 | 时间区间重叠检测、排课通知学员、取消原因弹窗 |
| 4 | `miniprogram/pages/coach/lessons/lessons.wxml` | 增强 | 取消原因弹窗 UI + 详情页原因展示 |
| 5 | `miniprogram/pages/student/booking/booking.js` | 增强 | 课时不足拦截、提交确认弹窗、通知教练 |
| 6 | `miniprogram/pages/student/lesson-detail/lesson-detail.js` | 增强 | 取消原因弹窗、确认/取消通知教练 |
| 7 | `miniprogram/pages/student/lesson-detail/lesson-detail.wxml` | 增强 | 取消原因弹窗 UI + 详情页原因展示 |

---

## 核心功能覆盖

### 1. 双向约课闭环 ✓

```
学员发起约课 ──→ 教练收到通知 ──→ 教练确认/取消 ──→ 学员收到通知
教练主动排课 ──→ 学员收到通知 ──→ 学员确认/取消 ──→ 教练收到通知
任一方取消 ───→ 对方收到通知 + 取消原因记录
教练标记完成 ──→ 自动扣减 1 课时（已有逻辑，未改动）
```

### 2. 时间冲突检测 ✓

- **教练端**：`_occupiedRanges` + 区间重叠算法 (`newStart < r.end && newEnd > r.start`)
- **学员端**：同样使用区间重叠检测（非仅字符串匹配）
- 冲突时前端阻止提交并 Toast 提示

### 3. 订阅消息基础设施 ✓

- `sendSubscribeMsg` 云函数已优化，支持 5 种场景模板字段
- 模板 ID 为占位符时静默跳过（不影响业务）
- `wx.requestSubscribeMessage` 调用框架就绪，填入真实模板 ID 后自动生效

### 4. 边界条件处理 ✓

- 课时不足（remaining <= 0）：弹窗拦截，无法提交
- 过去日期：灰色不可选
- 时间冲突：阻止提交
- 取消原因：支持输入（选填），写入 `cancel_by` + `cancel_reason`
- 未绑定 openid：通知静默跳过（不报错）

---

## 已知待办（非本次范围）

- 订阅消息模板 ID 需在微信公众平台申请后替换（`sendSubscribeMsg/index.js`）
- `wx.requestSubscribeMessage` 的 tmplIds 需填入实际模板 ID
- Phase 6: AI 训练记录（语音录入 + LLM 解析页面）

---

## 改动前后对比

| 维度 | Phase 1-4 状态 | Phase 5 后 |
|------|---------------|-----------|
| 教练端排课冲突检测 | 仅字符串匹配 | 区间重叠检测 |
| 排课/约课后通知 | 无 | 异步通知对方 |
| 取消课程原因 | 不记录 | 弹窗输入 + 写入 DB |
| 学员课时不足处理 | 仅文字提示 | 弹窗拦截 + 无法提交 |
| 订阅消息云函数 | 骨架（固定字段） | 动态模板数据 + 优雅降级 |
| 学员端取消课程 | 简单确认弹窗 | 原因输入弹窗 + 通知教练 |
