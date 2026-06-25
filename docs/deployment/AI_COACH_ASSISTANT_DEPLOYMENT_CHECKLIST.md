# AI Coach Assistant v0.1 Deployment Checklist

This checklist covers the manual CloudBase steps that are required after the local implementation.

## CloudBase Collections

Create these collections before deploying the AI flow:

- `ai_conversations`
- `ai_messages`
- `ai_confirmations`
- `ai_call_logs`
- `ai_action_logs`

The runtime writes documents to these collections, but deployment should not rely on implicit collection creation.

## Cloud Functions

Deploy or update these functions in environment `cloud1-d6gspyhgucab5be98`:

- `aiCoachAssistant`
- `aiActionExecutor`

Recommended runtime settings:

- Node.js cloud function runtime compatible with existing project functions.
- Timeout at least `20s` for `aiCoachAssistant`, because it may call an OpenAI-compatible model endpoint.
- `aiActionExecutor` should remain callable only from the mini program cloud context.

## Model Environment Variables

Set these variables on `aiCoachAssistant` when model parsing is needed:

- `LLM_API_KEY`: API key for the OpenAI-compatible provider.
- `LLM_API_URL`: chat completions endpoint. Default fallback is `https://api.openai.com/v1/chat/completions`.
- `LLM_MODEL`: model name. Default fallback is `gpt-4o-mini`.

If `LLM_API_KEY` is missing, the function still returns rule-based answers and uses local parsing fallback for training records.

## Safety Boundaries

Confirm these requests return refusal and do not create `ai_confirmations`:

- Recharge lesson balance.
- Deduct lesson balance.
- Complete lesson and deduct balance.
- Delete students, lessons, or training records.
- Batch adjust data.
- External notifications.
- Full data export.
- AI configuration changes.

## Manual Smoke Tests

Run in WeChat DevTools after deployment:

- New coach session enters `AI助手` tab by default.
- Existing tabs still work: `AI助手`, `日程`, `学员`, `我的`.
- Ask for today's lessons and verify answer comes from current database data.
- Ask for low-balance students and missing training records.
- Create a lesson through AI and confirm the front end sends only `confirmationId`.
- Try expired, repeated, and wrong-user confirmation execution if test data allows.
- From lesson detail, student detail, and training record pages, jump into AI assistant and verify source context is consumed once.
- Save a training record through AI; verify records are upserted by `lesson_id`.

