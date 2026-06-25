# AI Coach Assistant V0.2 Deployment Checklist

This project now contains a native WeChat Mini Program under `miniprogram/` and CloudBase event functions under `cloudfunctions/`.

## Required CloudBase Collections

Create these collections before first deployment:

- `users`
- `students`
- `lessons`
- `lesson_summaries`
- `lesson_balance_logs`
- `coach_settings`
- `action_library`
- `action_aliases`
- `ai_messages`
- `ai_confirmations`
- `ai_call_logs`
- `ai_action_logs`
- `feedback`

## Cloud Functions

Deploy these functions to environment `cloud1-d6gspyhgucab5be98`:

- `getOpenid`
- `initUser`
- `saveStudent`
- `saveLesson`
- `completeLesson`
- `adjustLessonBalance`
- `saveActionLibraryItem`
- `aiCoachAssistant`
- `aiActionExecutor`
- `aiVoiceTranscribe`

Recommended timeout:

- `aiCoachAssistant`: at least 25 seconds
- `aiActionExecutor`: at least 15 seconds
- Business functions: 10 seconds

## Model Environment Variables

Set these on `aiCoachAssistant` when enabling the external OpenAI-compatible model path:

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`
- `LLM_TEMPERATURE`

If `LLM_BASE_URL` or `LLM_API_KEY` is missing, the function keeps deterministic rule-based fallback behavior.

## Manual Checks

- Open project in WeChat DevTools and replace `appid` in `project.config.json` if needed.
- Voice transcription is currently degraded to text input because the WechatSI plugin may not be available in the Mini Program plugin marketplace.
- Verify the app opens directly into `AI助手`.
- Verify `AI助手 | 日程 | 学员 | 我的` switch correctly with the text-only custom tab bar.
- Confirm no student-side page is registered in `miniprogram/app.json`.
- Create one student, create one manual lesson, mark it complete, and confirm a lesson balance log is created.
- Ask AI for today's lessons.
- Ask AI to create a lesson; confirm the front end sends only `confirmationId`.
- Try forbidden AI requests: recharge lessons, deduct lessons, delete data, notify student, auto-complete lesson.
- Try expired or repeated confirmation cards if test data allows.
