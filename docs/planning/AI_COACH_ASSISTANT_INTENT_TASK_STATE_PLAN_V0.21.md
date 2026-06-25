# AI 教练助手意图识别与多轮任务状态重构方案 v0.21

> 日期：2026-06-25  
> 状态：实施前方案  
> 范围：`aiCoachAssistant` 意图识别、多轮补槽、确认卡编辑、`aiActionExecutor` 二次校验联动  
> 目标：用 LLM 做 intent + extraction，用后端确定性代码执行，解决多轮上下文断裂与关键词误判问题  
> 本文不直接修改业务代码，仅作为后续实施依据
> 修订重点：统一 intent/action/card 枚举，补齐任务状态转移、中断策略、确认卡 schema 与迁移边界

---

## 1. 背景与根因

当前问题不是某一个正则写得不够全，而是后端缺少稳定的任务状态机。

典型失败链路：

```text
用户：给学员安排一节课
AI：要给哪位学员排课？
用户：子涵
AI：无法稳定知道“子涵”是在补学员字段
用户：今天下午3点
AI：可能被“今天”误判为查今日课表
用户：学校
AI：可能被当成普通聊天或无意图文本
```

根因：

- 每轮消息都被当作独立请求处理，没有保存“正在排课”的任务状态。
- `ai_messages` 只是聊天记录，不是可执行任务状态。
- 现有 `recentTexts + regex` 拼接上下文很脆弱，容易被短句、插话和时间词污染。
- 意图判断和槽位抽取混在一起，导致“今天下午3点排课”被“今天”抢走。

---

## 2. 目标架构

重构后采用五层结构：

```text
用户输入
  -> safetyGuard 强规则安全拦截
  -> taskStateResolver 读取未完成任务
  -> intentExtractor LLM 意图与槽位抽取
  -> slotResolver 后端确定性解析与补全
  -> taskPlanner 追问 / 查询 / 确认卡
  -> aiActionExecutor 确认后确定性执行
```

核心原则：

- LLM 只负责理解自然语言，不直接决定写库。
- 后端只接受 schema 校验通过的 LLM 输出。
- 所有写入类任务仍必须生成确认卡。
- 前端确认只传 `confirmationId + userEdits`。
- `aiActionExecutor` 重新读取服务端 payload 并二次校验。
- 安全拦截继续使用强规则优先，不交给 LLM。
- `intent` 表示用户想做什么，`action_type` 表示确认后执行什么，二者不能混用。
- 第一版仍沿用后端 `modelAdapter` 调 OpenAI-compatible API；小程序端 `wx.cloud.extend.AI` 只作为后续可替换 provider，不作为本次实现默认依赖。

---

## 3. 数据库新增与调整

### 3.1 新增集合：`ai_task_state`

用于保存多轮任务状态。

```js
{
  _id,
  schema_version: 1,
  coach_openid,
  intent: "create_lesson | generate_training_plan | save_lesson_summary | query_student | query_today_lessons | other",
  status: "collecting | confirmation_created | completed | cancelled | expired | failed",
  slots: {
    student_name: "",
    student_id: "",
    date_text: "",
    date: "",
    start_time_text: "",
    start_time: "",
    end_time_text: "",
    end_time: "",
    duration_minutes: null,
    location: "",
    lesson_units: null,
    lesson_id: "",
    lesson_ref_text: "",
    training_theme: "",
    summary_text: "",
    raw_actions: []
  },
  missing_slots: [],
  blocked_reason: "",
  last_question: "",
  source_context: {},
  confirmation_id: "",
  expires_at,
  created_at,
  updated_at
}
```

索引建议：

```text
coach_openid + status + expires_at
coach_openid + updated_at
confirmation_id
```

过期策略：

- `collecting` 状态默认 10 分钟过期。
- 生成确认卡后状态改为 `confirmation_created`。
- 确认卡仍保持原有 15 分钟有效期。
- 过期不物理删除，查询未完成任务时只读取 `status = collecting` 且 `expires_at > now` 的记录。
- 旧状态由定时清理或下一次请求懒更新为 `expired`，避免每轮请求扫描大量历史记录。

状态转移规则：

| 当前状态 | 触发条件 | 下一状态 | 说明 |
| --- | --- | --- | --- |
| 无 | 新写入类意图且缺槽 | `collecting` | 创建 `ai_task_state` 并保存已知 slots |
| `collecting` | 补槽后仍缺字段 | `collecting` | 更新 slots、missing_slots、last_question、expires_at |
| `collecting` | 字段齐全且校验通过 | `confirmation_created` | 创建确认卡并写入 `confirmation_id` |
| `collecting` | 用户取消 / 重来 | `cancelled` | 不生成确认卡 |
| `collecting` | 超过 10 分钟 | `expired` | 不再作为补槽上下文 |
| `confirmation_created` | 确认卡执行成功 | `completed` | 由 `aiActionExecutor` 回写 |
| `confirmation_created` | 确认卡执行失败 | `failed` | 保留失败原因，允许用户重新发起 |
| `confirmation_created` | 确认卡过期或取消 | `expired` / `cancelled` | 与 `ai_confirmations.status` 保持一致 |

### 3.2 受影响的既有集合

- `ai_messages`：继续保存对话记录，但不再承担任务上下文职责。
- `ai_confirmations`：新增或强化 `task_state_id` 字段，便于从确认卡追溯任务。
- `ai_action_logs`：建议增加 `task_state_id`，方便排查多轮任务执行结果。

---

## 4. LLM Intent + Extraction Schema

### 4.1 统一输出结构

LLM 输出必须符合固定 schema：

```js
{
  intent: "query_today_lessons | query_student | create_lesson | generate_training_plan | save_lesson_summary | other",
  confidence: 0.0,
  entities: {
    student_name: "",
    date_text: "",
    start_time_text: "",
    end_time_text: "",
    duration_minutes: null,
    location: "",
    lesson_id: "",
    lesson_ref_text: "",
    training_theme: "",
    summary_text: "",
    raw_actions: []
  },
  task_control: "none | cancel_current | switch_task",
  missing_slots: [
    "student_name",
    "date_text",
    "start_time_text",
    "location"
  ],
  normalized_text: "",
  clarification_question: ""
}
```

约束：

- `intent` 必须是枚举。
- `missing_slots` 只能包含白名单字段。
- LLM 不允许返回 `coach_openid`、`_openid`、数据库 ID 的伪造值。
- LLM 不允许返回 `action_type`。
- LLM 不决定是否执行写入，只抽取用户表达。
- `generate_training_plan` 表示用户要生成课前方案；确认后落库动作才是 `save_training_plan`。
- `task_control` 只能用于提示后端“用户想取消或切换任务”，最终是否取消 / 切换由后端规则决定。

### 4.2 Intent / Action / Card 映射

实现时必须按下表分层，避免把模型意图直接当作执行动作。

| 用户意图 `intent` | 是否写入 | Planner 输出 | 确认卡 `action_type` | `card_type` |
| --- | --- | --- | --- | --- |
| `query_today_lessons` | 否 | 今日课表文本 / 数据卡 | 无 | 无 |
| `query_student` | 否 | 学员摘要文本 / 数据卡 | 无 | 无 |
| `create_lesson` | 是 | 排课确认卡 | `create_lesson` | `schedule_confirm_card` |
| `generate_training_plan` | 是 | 课前训练方案确认卡 | `save_training_plan` | `training_plan_confirm_card` |
| `save_lesson_summary` | 是 | 课程训练总结确认卡 | `save_lesson_summary` | `lesson_summary_confirm_card` |
| `other` | 否 | 能力说明 / 追问 | 无 | 无 |

### 4.3 Function Calling 优先，JSON fallback

`modelAdapter.generateIntentExtraction()` 实现两种模式：

1. Provider 支持 tools / function calling：
   - 定义工具 `extract_coach_intent`
   - 工具参数为上述 schema
   - 只接受 tool arguments

2. Provider 不支持 function calling：
   - 使用 `response_format: { type: "json_object" }`
   - system prompt 强制返回同 schema
   - 后端进行 schema validation

后端统一调用：

```js
const extraction = await intentExtractor.extract({
  text,
  previousTaskState,
  sourceContext,
  clientTime
});
```

---

## 5. 后端确定性处理

### 5.1 `safetyGuard`

强规则优先，只拦截高风险动作：

```text
充值课时
扣减课时
删除学员/课程/总结
批量调整
自动通知学员
自动完课扣课时
导出数据
修改 AI 模型或额度配置
```

命中后直接返回 `refusal`，不调用 LLM。

### 5.2 `taskStateResolver`

每次用户输入时先查：

```js
ai_task_state.where({
  coach_openid: OPENID,
  status: "collecting",
  expires_at: _.gt(now)
}).orderBy("updated_at", "desc").limit(1)
```

如果存在未完成任务：

- 当前输入先进入中断判断，再决定是否作为该任务的补槽输入。
- LLM prompt 中带入当前 `intent`、已有 `slots`、`missing_slots`。
- 如果判断为补槽，LLM 只需要抽取本轮新增信息。

如果不存在未完成任务：

- 当前输入作为新任务首轮输入。

中断策略：

| 用户输入类型 | 示例 | 处理方式 |
| --- | --- | --- |
| 明确取消 | `算了`、`取消排课`、`重新来` | 将当前 task_state 标记为 `cancelled`，不调用执行器 |
| 高置信只读查询 | `今天有哪些课`、`下一节课是谁` | 暂停补槽，直接执行查询；原 task_state 保持 `collecting` 且刷新不超过一次有效期 |
| 明确切换到新写入任务 | `先记录刚才这节课`、`改成给小王写总结` | 返回确认追问：“要放弃当前排课任务并开始新任务吗？”确认后取消旧任务 |
| 无关闲聊或低置信文本 | `谢谢`、`等一下` | 不合并 slots，返回当前缺失字段提示 |
| 与缺失字段匹配 | `子涵`、`今天下午3点`、`学校` | 作为当前 task_state 补槽输入 |

同一教练同一时间只允许一个 `collecting` 写入任务作为默认补槽目标。若历史数据中存在多个未过期 `collecting`，只取 `updated_at` 最新的一条，其余标记为 `cancelled` 或 `expired` 并写日志。

### 5.3 `slotResolver`

LLM 输出后，后端确定性补全：

#### 5.3.1 排课 `create_lesson`

排课 `create_lesson` 必填最终字段：

```text
student_id
date
start_time
end_time
location
lesson_units
```

后端负责：

- `student_name -> student_id`
- 同名学员判断
- 学员不存在判断
- `今天 / 明天 / 后天 / 6月26日 -> YYYY-MM-DD`
- `下午三点 / 15:00 / 3点半 -> HH:mm`
- 未给结束时间时按默认课时时长补齐
- 根据开始/结束时间重新计算消耗课时
- 地点缺失时优先用学员常用地点，否则追问
- 检查课时余额
- 检查时间冲突

课时计算规则：

```text
<= 30 分钟 -> 0.5
<= 60 分钟 -> 1
<= 90 分钟 -> 1.5
> 90 分钟 -> 2
```

#### 5.3.2 课前训练方案 `generate_training_plan`

课前训练方案必须绑定到单节课程。必填最终字段：

```text
lesson_id
training_theme
```

后端负责：

- 优先使用 `sourceContext.lesson_id`。
- 如果没有 `lesson_id`，根据 `lesson_ref_text`、学员名、日期、时间查找候选课程。
- 找到 0 节课时追问“是哪一节课？”。
- 找到多节候选课程时返回选择卡或文本列表，不生成确认卡。
- 找到 1 节课后校验课程属于当前教练且未取消。
- `training_theme` 缺失时可用“本节课训练方案”兜底，但确认卡中必须展示可编辑主题。
- 已有训练方案时，确认卡必须展示“确认后将覆盖/更新原方案”的 warning。

`intent=generate_training_plan` 只表示生成方案需求；最终确认卡写库动作必须是 `action_type=save_training_plan`。

#### 5.3.3 课程训练总结 `save_lesson_summary`

课程训练总结必须绑定到单节课程。必填最终字段：

```text
lesson_id
summary_text
```

后端负责：

- 优先使用 `sourceContext.lesson_id`。
- 如果没有 `lesson_id`，优先查找最近一节 `status = completed` 且 `summary_status != completed` 的课程。
- 若用户表达包含学员名、日期或“刚才/上一节”，用这些信息缩小候选课程。
- 找到 0 节课时追问课程对象。
- 找到多节候选课程时返回选择卡或文本列表，不生成确认卡。
- `summary_text` 过短或只有“记录训练”这类入口语时，追问课后实际情况。
- 动作归一只生成 `raw_actions` 和归一建议，不确定动作保留原始名称，确认卡必须提示教练检查。

### 5.4 `taskPlanner`

根据 `intent + resolvedSlots` 输出：

- 查询类：直接返回卡片或文本。
- 信息缺失：更新 `ai_task_state`，返回追问。
- 写入类字段齐全：创建确认卡，更新 `ai_task_state.status = confirmation_created`。
- 校验失败：返回明确原因，不生成可执行确认卡。

---

## 6. 多轮排课流程

示例：

```text
用户：给学员安排一节课
LLM：intent=create_lesson, missing_slots=[student_name,date_text,start_time_text]
后端：创建 ai_task_state
AI：要给哪位学员排课？

用户：子涵
后端：读取 collecting task_state
LLM：entities.student_name=子涵
后端：解析 student_id，仍缺 date/start_time/location
AI：安排哪一天几点？

用户：今天下午3点
后端：合并 date/start_time，学员无默认地点时仍缺 location
AI：本次上课地点是哪里？

用户：学校
后端：合并 location，字段齐全
AI：生成排课确认卡
```

这个流程解决：

- 单独说“子涵”可被识别为学员槽位。
- 单独说“今天下午3点”不会被误判成今日课表。
- 单独说“学校”可被识别为地点槽位。
- 中间插入无关话题时，任务状态仍可按超时策略处理。

---

## 7. 确认卡与执行器调整

### 7.1 确认卡 payload

`ai_confirmations.payload` 保存服务端版本：

```js
{
  schema_version: 2,
  task_state_id,
  student_id,
  date,
  start_time,
  end_time,
  location,
  lesson_units,
  source: "ai"
}
```

确认卡可编辑字段：

```js
editable_fields: ["date", "start_time", "end_time", "location"]
```

不允许前端最终决定 `lesson_units`。

兼容规则：

- 新建确认卡统一写入 `schema_version: 2`。
- `schema_version: 2` 的排课确认卡使用 `date + start_time + end_time` 作为可编辑字段，执行器在服务端转换为 `start_at/end_at`。
- 如果执行器遇到旧确认卡没有 `schema_version`，只能按旧 payload 兼容一次，且不允许接受前端提交的 `lesson_units` 覆盖。
- 旧 pending 确认卡若缺少必要字段，应在执行时返回 `CONFIRMATION_SCHEMA_OUTDATED`，提示用户重新发起。
- `task_state_id` 必须写入 `ai_confirmations`、`ai_action_logs`，方便从执行结果回写任务状态。

### 7.2 前端确认卡

`miniprogram/components/confirm-card` 需要保留并完善：

- 日期 picker
- 开始时间 picker
- 结束时间 picker
- 地点 input
- 消耗课时只展示计算结果

前端可实时展示课时计算结果，但只是 UI 提示。

前端提交规则：

- `userEdits` 只提交 `editable_fields` 中声明的字段。
- 即使 UI 内部为了展示计算了 `lesson_units`，也不要把它作为最终可编辑字段发送。
- 取消确认卡时需要调用取消接口或在下一版补充 `aiActionExecutor` 的 cancel action，确保 `ai_confirmations` 与 `ai_task_state` 状态同步。

### 7.3 `aiActionExecutor`

执行时必须重新计算：

```js
lesson_units = durationToUnits(start_time, end_time)
```

并重新校验：

- 课程时间合法
- 时间冲突
- 学员归属
- 剩余课时足够
- 地点不为空
- 确认卡未过期、未使用、属当前教练
- `userEdits` 不包含未授权字段；包含时忽略并写入日志
- 执行成功 / 失败 / 过期后回写 `ai_task_state.status`

---

## 8. 受影响代码清单

### 8.1 必改

`cloudfunctions/aiCoachAssistant/index.js`

- 删除大部分意图正则作为主判断。
- 保留 `safetyGuard`。
- 新增 `taskStateResolver`、`slotResolver`、`taskPlanner`。
- 所有写入类任务通过 task state 和确认卡生成。

`cloudfunctions/aiCoachAssistant/lib/modelAdapter.js`

- 新增 `generateIntentExtraction()`。
- 支持 function calling / tool call。
- 保留 JSON fallback。

`cloudfunctions/aiActionExecutor/index.js`

- 不信任前端传入 `lesson_units`。
- 根据开始/结束时间重新计算课时。
- 可写 `task_state_id` 到日志。

`miniprogram/components/confirm-card/*`

- 确认卡编辑字段与 `editable_fields` 对齐。
- 课时只展示，不作为最终输入。

### 8.2 需要联动调整

`miniprogram/pages/coach/ai-assistant/ai-assistant.js`

- 无需承担多轮上下文拼接。
- 继续发送原始文本和 `sourceContext`。
- 可在 UI 上展示追问与确认卡。

`miniprogram/utils/aiApi.js`

- 接口不需要大改。
- `sendAiMessage` 仍发送 `{ text, inputType, sourceContext, clientTime }`。

部署清单

- 新增集合 `ai_task_state`。
- 增加索引。
- 重新部署 `aiCoachAssistant`、`aiActionExecutor`。
- 若使用 function calling，需要确认当前模型服务商是否兼容 tools。

---

## 9. 兼容与迁移

无需迁移历史业务数据。

运行态数据按环境处理：

| 数据 | 开发环境 | 生产环境 |
| --- | --- | --- |
| `ai_messages` | 可清理 | 不建议删除，作为用户对话历史保留 |
| `ai_confirmations` | 可清理 pending / expired | 只失效旧 pending 卡，不删除历史 confirmed / failed 记录 |
| `ai_task_state` | 可清理 | 仅将过期 collecting 标记为 `expired` |
| `ai_call_logs` | 可清理 | 不建议删除，可后续归档 |
| `ai_action_logs` | 可清理 | 不建议删除，是执行审计依据 |

生产环境迁移步骤：

1. 新增 `ai_task_state` 集合和索引。
2. 给新确认卡写入 `schema_version: 2` 与 `task_state_id`。
3. 将旧 `status = pending` 且没有 `schema_version` 的确认卡标记为 `expired` 或在执行时返回 `CONFIRMATION_SCHEMA_OUTDATED`。
4. 保留 `ai_messages`、`ai_call_logs`、`ai_action_logs`，用于问题排查和审计。
5. 不迁移历史确认卡到 `ai_task_state`，因为旧卡缺少完整多轮状态。

不要因为本次重构清空：

```text
students
lessons
lesson_balance_logs
coach_settings
lesson_summaries
```

除非只是开发测试且明确不需要旧数据。

---

## 10. 测试用例

### 10.1 查课

```text
今天有哪些课
今日课表
下一节课是谁
今天下午3点有课吗
```

预期：查询课表，不生成排课确认卡。

### 10.2 单轮排课

```text
给子涵今天下午3点排一节课
给子涵后天下午4点上一节课
帮我给子涵加一节明天下午三点的训练
给子涵明天15:30在学校排一节课
```

预期：字段齐全时生成排课确认卡；缺地点且无默认地点时追问。

### 10.3 多轮排课

```text
给学员安排一节课
子涵
今天下午3点
学校
```

预期：持续使用同一个 `ai_task_state`，最后生成确认卡。

### 10.4 多轮中断与切换

```text
给学员安排一节课
今天有哪些课
子涵
取消排课
```

预期：

- `今天有哪些课` 执行查询，不污染排课 slots。
- `子涵` 回到原排课任务补槽。
- `取消排课` 将当前 `ai_task_state.status` 标记为 `cancelled`。

```text
给学员安排一节课
先记录刚才这节课
```

预期：不直接切换写入任务，先追问是否放弃当前排课任务。

### 10.5 训练方案与课程总结

```text
帮这节课生成胸肩训练方案
记录刚才这节课，卧推做了4组，最后一组有点吃力
```

预期：

- 有 `sourceContext.lesson_id` 时绑定该课程。
- 没有 `sourceContext.lesson_id` 时按最近课程或候选课程追问。
- 训练方案生成 `action_type=save_training_plan` 的确认卡。
- 课程总结生成 `action_type=save_lesson_summary` 的确认卡。

### 10.6 边界与异常

```text
给子涵明天下午3点排一节课
给不存在的学员明天下午3点排一节课
给同名学员明天下午3点排一节课
```

预期：

- 课时不足时不生成确认卡。
- 时间冲突时不生成确认卡。
- 学员不存在时追问或提示先建档。
- 多个同名学员时必须让教练选择，不猜测 `student_id`。

LLM 异常用例：

- 返回非法 JSON。
- 返回未声明 intent。
- 返回额外 `_openid` / `coach_openid` / `action_type`。
- 返回 missing_slots 中不存在的字段。

预期：schema validation 失败，不写库，不生成确认卡，返回可理解的重试提示。

### 10.7 安全拦截

```text
帮我扣子涵一节课
给子涵充值10节课
删除子涵
通知子涵明天来上课
导出全部学员数据
```

预期：直接拒绝，不调用 LLM，不生成确认卡。

### 10.8 确认卡编辑与执行

操作：

- 修改日期
- 修改开始时间
- 修改结束时间
- 修改地点

预期：

- UI 实时展示新课时。
- 后端确认时重新计算课时。
- 课时不足或时间冲突时执行失败并提示原因。
- 重复点击确认只成功一次。
- 过期确认卡执行失败，并同步 `ai_task_state.status = expired`。
- 非当前教练执行返回 `NOT_OWNER`。

---

## 11. 实施顺序

1. 新增 `ai_task_state` 集合与索引。
2. 固化 `intent -> action_type -> card_type` 映射常量。
3. 在 `modelAdapter` 增加 schema / function calling 抽取方法；当前 provider 不支持 tools 时走 JSON fallback。
4. 在 `aiCoachAssistant` 增加 schema validation，拒绝多余敏感字段和非法枚举。
5. 实现 `taskStateResolver`，优先读取 collecting 状态，并支持取消、查询插话、任务切换判断。
6. 实现 `slotResolver`，覆盖排课、训练方案、课程总结的必填字段。
7. 实现 `taskPlanner`，统一追问、查询和确认卡生成。
8. 调整确认卡 payload，写入 `schema_version: 2`、`task_state_id`，并移除 `lesson_units` 前端可编辑权限。
9. 调整 `miniprogram/components/confirm-card`，课时只展示，不作为最终输入。
10. 调整 `aiActionExecutor`，后端重新计算课时，校验 schema，并回写 `ai_task_state.status`。
11. 按生产迁移策略失效旧 pending 确认卡，不删除审计日志。
12. 按测试用例回归。

---

## 12. 验收标准

- “今天下午3点排课”不会被误判为今日课表。
- “今天有哪些课”不会被误判为排课。
- 多轮输入 `子涵 / 今天下午3点 / 学校` 可以接上同一个排课任务。
- LLM 输出不合 schema 时不会写库。
- 安全拦截命中时不调用 LLM。
- 所有写入仍必须确认卡确认后执行。
- 确认卡编辑后的日期、时间、地点以服务端二次校验后的结果为准。
- 前端不传 `coach_openid` / `_openid`。
- `generate_training_plan` 不会被误写成确认卡 `action_type`；确认卡执行动作使用 `save_training_plan`。
- 用户在补槽中途查课不会污染当前写入任务。
- 确认卡成功、失败、过期、取消后，`ai_task_state` 与 `ai_confirmations` 状态一致。
