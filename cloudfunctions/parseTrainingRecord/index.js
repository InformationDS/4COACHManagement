// cloudfunctions/parseTrainingRecord/index.js
// AI 结构化训练记录 —— 将自然语言转为结构化训练数据
// 依赖：外部 LLM API（如 OpenAI / Claude / 国内大模型）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// TODO: 配置你的 LLM API Key 和环境变量
// 在云函数环境变量中设置 LLM_API_KEY、LLM_API_URL、LLM_MODEL

/**
 * 默认 LLM 配置
 * 支持 OpenAI 兼容接口，可替换为任意兼容的模型服务
 */
const LLM_CONFIG = {
  apiKey: process.env.LLM_API_KEY || '',      // 从环境变量读取
  apiUrl: process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions',
  model: process.env.LLM_MODEL || 'gpt-4o-mini',  // 推荐性价比模型
  maxTokens: 800,
  temperature: 0.1  // 低温度确保稳定输出
};

/**
 * 预期返回的 JSON Schema 描述（嵌入 Prompt）
 */
const STRUCTURED_PROMPT = `
你是一个专业的健身训练记录助手。请将教练的语音转文字内容解析为以下 JSON 格式：

{
  "body_parts": ["训练部位1", "训练部位2"],
  "exercises": [
    {
      "name": "动作名称",
      "sets": 组数(数字),
      "reps": 次数(数字),
      "weight": "重量(如 60kg 或 15kg 或 自重)"
    }
  ],
  "notes": "课堂备注（教练对学员状态的观察、建议等，提取关键信息，不要重复原始文本）"
}

规则：
1. body_parts 从以下选项中匹配：胸部、背部、腿部、肩部、手臂、核心、有氧、其他
2. 如果原文没有明确提及训练部位，请根据动作推断
3. exercises 中每个动作提取 name/sets/reps/weight，如果原文未提及某个字段，可设为 0 或空字符串
4. notes 提取与训练数据无关的观察性语句，如"今天状态不错"、"注意左肩"等
5. 只返回 JSON，不要包含任何其他文字
`;

exports.main = async (event, context) => {
  const { text, studentName, lessonDate } = event;

  if (!text || !text.trim()) {
    return { success: false, message: '语音文本为空' };
  }

  // 如果未配置 API Key，返回降级结果
  if (!LLM_CONFIG.apiKey) {
    console.warn('LLM API Key 未配置，返回降级结果');
    return {
      success: true,
      degraded: true,
      data: {
        body_parts: [],
        exercises: [],
        notes: text
      }
    };
  }

  try {
    const response = await callLLM(text, studentName, lessonDate);
    const parsed = parseResponse(response);

    return {
      success: true,
      data: parsed,
      usage: response.usage  // 返回 token 用量供日志分析
    };
  } catch (err) {
    console.error('AI 解析失败:', err);

    // 降级：返回原始文本作为备注
    return {
      success: true,
      degraded: true,
      data: {
        body_parts: [],
        exercises: [],
        notes: text
      },
      error: err.message
    };
  }
};

/**
 * 调用 LLM API
 */
async function callLLM(text, studentName, lessonDate) {
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');

  const apiUrl = new URL(LLM_CONFIG.apiUrl);
  const httpModule = apiUrl.protocol === 'https:' ? https : http;

  const requestBody = JSON.stringify({
    model: LLM_CONFIG.model,
    messages: [
      {
        role: 'system',
        content: STRUCTURED_PROMPT
      },
      {
        role: 'user',
        content: `学员：${studentName || '未知'}\n日期：${lessonDate || ''}\n教练口述：${text}`
      }
    ],
    max_tokens: LLM_CONFIG.maxTokens,
    temperature: LLM_CONFIG.temperature,
    response_format: { type: 'json_object' }  // 要求 JSON 输出（OpenAI 兼容）
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: apiUrl.hostname,
      port: apiUrl.port,
      path: apiUrl.pathname + apiUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_CONFIG.apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 15000
    };

    const req = httpModule.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.error) {
            reject(new Error(result.error.message || 'API 调用错误'));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error('解析 API 响应失败'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API 请求超时')); });
    req.write(requestBody);
    req.end();
  });
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseResponse(response) {
  const choice = response.choices && response.choices[0];
  if (!choice || !choice.message) {
    throw new Error('API 返回格式异常');
  }

  const content = choice.message.content;
  let parsed;

  // 尝试直接解析
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    // 尝试提取 JSON（如果 LLM 在 JSON 外包裹了文字）
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      throw new Error('无法解析 AI 返回的 JSON');
    }
  }

  // 规范化字段
  return {
    body_parts: Array.isArray(parsed.body_parts) ? parsed.body_parts : [],
    exercises: Array.isArray(parsed.exercises) ? parsed.exercises.map(ex => ({
      name: ex.name || '',
      sets: Number(ex.sets) || 0,
      reps: Number(ex.reps) || 0,
      weight: ex.weight || ''
    })) : [],
    notes: parsed.notes || ''
  };
}
