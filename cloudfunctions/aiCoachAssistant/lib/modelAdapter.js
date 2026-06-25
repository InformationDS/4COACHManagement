const https = require("https");
const http = require("http");

function requestJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const req = client.request({
      method: "POST",
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
      path: `${parsed.pathname}${parsed.search}`,
      headers,
      timeout: timeoutMs
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`LLM request failed: ${res.statusCode} ${raw.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("LLM request timeout"));
    });
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function generateJson({ system, messages, schema }) {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || process.env.LLM_API_URL;
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 20000);
  const temperature = Number(process.env.LLM_TEMPERATURE || 0.2);

  if (!apiKey || !baseUrl) {
    return {
      usedModel: false,
      provider: "local_fallback",
      model: "rules",
      data: null,
      usage: null
    };
  }

  const response = await requestJson(baseUrl, {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  }, {
    model,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\nReturn strict JSON only. Schema hint: ${JSON.stringify(schema)}` },
      ...messages
    ]
  }, timeoutMs);

  const content = response.choices && response.choices[0] && response.choices[0].message ? response.choices[0].message.content : "{}";
  return {
    usedModel: true,
    provider: "openai_compatible",
    model,
    data: JSON.parse(content),
    usage: response.usage || null
  };
}

async function generateIntentExtraction({ text, previousTaskState, sourceContext, clientTime }) {
  const schema = {
    intent: "query_today_lessons | query_student | create_lesson | generate_training_plan | save_lesson_summary | other",
    confidence: "number between 0 and 1",
    entities: {
      student_name: "student name mentioned by the user, no database ids",
      date_text: "relative or absolute date text",
      start_time_text: "start time text",
      end_time_text: "end time text",
      duration_minutes: "number or null",
      location: "lesson location",
      lesson_ref_text: "text that identifies a lesson, no database ids",
      training_theme: "training plan theme",
      summary_text: "lesson summary text",
      raw_actions: "array of raw exercise/action names"
    },
    task_control: "none | cancel_current | switch_task",
    missing_slots: "array of allowed slot names only",
    normalized_text: "concise Chinese rewrite preserving concrete entities",
    clarification_question: "short Chinese follow-up question when useful"
  };
  const system = [
    "You extract intent and slots for a Chinese private fitness coach mini program.",
    "Return only the schema fields. Do not include coach_openid, _openid, database IDs, or action_type.",
    "Intent means the user's goal, not the backend write action.",
    "Use generate_training_plan when the user asks for a pre-class training plan.",
    "Use save_lesson_summary when the user asks to record or summarize actual training after a class.",
    "Use create_lesson when the user wants to arrange, book, add, or schedule a lesson.",
    "If previousTaskState exists, extract only new slot information unless the user clearly cancels or switches task.",
    "For cancellation phrases such as 算了, 取消, 不用了, return task_control cancel_current.",
    "For a high-confidence read query such as 今天有哪些课, return that read intent even if previousTaskState exists."
  ].join("\n");
  const messages = [
    {
      role: "user",
      content: JSON.stringify({
        text,
        previousTaskState: previousTaskState ? {
          intent: previousTaskState.intent,
          slots: previousTaskState.slots || {},
          missing_slots: previousTaskState.missing_slots || []
        } : null,
        sourceContext: sourceContext || {},
        clientTime: clientTime || ""
      })
    }
  ];
  return generateJson({ system, messages, schema });
}

module.exports = {
  generateJson,
  generateIntentExtraction
};
