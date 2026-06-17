const http = require('http');
const https = require('https');
const { URL } = require('url');

const CONFIG = {
  apiKey: process.env.LLM_API_KEY || '',
  apiUrl: process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions',
  model: process.env.LLM_MODEL || 'gpt-4o-mini',
  timeout: 15000
};

function isConfigured() {
  return !!CONFIG.apiKey;
}

async function generateJson({ system, user, maxTokens = 800, temperature = 0.1 }) {
  if (!isConfigured()) {
    return { ok: false, skipped: true, message: 'LLM_API_KEY is not configured' };
  }

  const apiUrl = new URL(CONFIG.apiUrl);
  const httpModule = apiUrl.protocol === 'https:' ? https : http;
  const requestBody = JSON.stringify({
    model: CONFIG.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    max_tokens: maxTokens,
    temperature,
    response_format: { type: 'json_object' }
  });

  return new Promise((resolve, reject) => {
    const req = httpModule.request({
      hostname: apiUrl.hostname,
      port: apiUrl.port,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: CONFIG.timeout
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.error) {
            resolve({ ok: false, message: data.error.message || 'model error', raw: data });
            return;
          }
          const content = data.choices && data.choices[0] && data.choices[0].message
            ? data.choices[0].message.content
            : '';
          resolve({
            ok: true,
            data: parseJsonContent(content),
            usage: data.usage || {},
            model: data.model || CONFIG.model
          });
        } catch (err) {
          resolve({ ok: false, message: err.message || 'invalid model response' });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('model request timeout'));
    });
    req.write(requestBody);
    req.end();
  });
}

async function parseTrainingRecord(text) {
  const system = [
    '你是私教训练记录结构化助手。',
    '只返回 JSON，不要解释。',
    'JSON 字段：body_parts:string[], exercises:{name:string,sets:number,reps:number,weight:string}[], notes:string。',
    '无法确定的字段使用空数组、0 或空字符串，不要编造。'
  ].join('\n');
  const res = await generateJson({
    system,
    user: `教练口述：${text}`,
    maxTokens: 700,
    temperature: 0.1
  });
  if (!res.ok || !res.data) return res;
  return {
    ok: true,
    data: {
      body_parts: Array.isArray(res.data.body_parts) ? res.data.body_parts : [],
      exercises: Array.isArray(res.data.exercises) ? res.data.exercises.map(item => ({
        name: String(item.name || '').trim(),
        sets: Number(item.sets || 0),
        reps: Number(item.reps || 0),
        weight: String(item.weight || '').trim()
      })).filter(item => item.name) : [],
      notes: String(res.data.notes || '').trim()
    },
    usage: res.usage || {},
    model: res.model || CONFIG.model
  };
}

async function classifyCoachIntent({ text, sourceContext = {}, clientDate = '' }) {
  const system = [
    '你是私教小程序 AI 助手的意图路由器。',
    '只返回 JSON，不要解释。',
    '必须从 allowed_intents 里选择一个 intent。',
    'allowed_intents: query_today_lessons, query_student, analyze_student, create_lesson, update_lesson, cancel_lesson, create_training_record, missing_training_records, low_balance_students, operation_review, update_student_note, unknown。',
    '不要执行任何动作，只识别用户想做什么，并抽取槽位。',
    '槽位字段：student_name, lesson_id, student_id, date_text, start_time_text, location, body_parts, exercises_text, note_text。',
    '如果用户说“最近练得怎么样/训练情况/分析”，intent 应为 analyze_student。',
    '如果用户说“记录训练/补训练记录/练胸/卧推/高位下拉”等，intent 应为 create_training_record。',
    '如果用户只补充一个姓名或数字，并且上下文有 previous_intent，则延续 previous_intent。',
    'confidence 取 0 到 1；缺少关键槽位时写 missing_slots。'
  ].join('\n');
  const user = JSON.stringify({
    text,
    client_date: clientDate,
    previous_intent: sourceContext.intent || '',
    previous_input: sourceContext.previous_input || '',
    source: sourceContext.source || '',
    lesson_id: sourceContext.lesson_id || '',
    student_id: sourceContext.student_id || ''
  });
  const res = await generateJson({
    system,
    user,
    maxTokens: 700,
    temperature: 0
  });
  if (!res.ok || !res.data) return res;
  const data = res.data || {};
  return {
    ok: true,
    data: {
      intent: normalizeIntent(data.intent),
      confidence: clampConfidence(data.confidence),
      slots: normalizeSlots(data.slots || data),
      missing_slots: Array.isArray(data.missing_slots) ? data.missing_slots.map(String) : [],
      reason: String(data.reason || '').slice(0, 120)
    },
    usage: res.usage || {},
    model: res.model || CONFIG.model
  };
}

function normalizeIntent(intent) {
  const allowed = new Set([
    'query_today_lessons',
    'query_student',
    'analyze_student',
    'create_lesson',
    'update_lesson',
    'cancel_lesson',
    'create_training_record',
    'missing_training_records',
    'low_balance_students',
    'operation_review',
    'update_student_note',
    'unknown'
  ]);
  return allowed.has(intent) ? intent : 'unknown';
}

function normalizeSlots(slots) {
  return {
    student_name: String(slots.student_name || '').trim(),
    lesson_id: String(slots.lesson_id || '').trim(),
    student_id: String(slots.student_id || '').trim(),
    date_text: String(slots.date_text || '').trim(),
    start_time_text: String(slots.start_time_text || '').trim(),
    location: String(slots.location || '').trim(),
    body_parts: Array.isArray(slots.body_parts) ? slots.body_parts.map(String).filter(Boolean) : [],
    exercises_text: String(slots.exercises_text || '').trim(),
    note_text: String(slots.note_text || '').trim()
  };
}

function clampConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function parseJsonContent(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch (err) {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw err;
    return JSON.parse(match[0]);
  }
}

module.exports = {
  isConfigured,
  generateJson,
  parseTrainingRecord,
  classifyCoachIntent
};
