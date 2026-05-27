const PROVIDERS = {
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    url: 'https://api.anthropic.com/v1/messages',
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/responses',
  },
  gemini: {
    envKey: 'GEMINI_API_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
  },
};

export function inferProvider(model) {
  if (!model) return null;
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-') || model.startsWith('o')) return 'openai';
  if (model.startsWith('gemini-')) return 'gemini';
  return null;
}

export function resolveApiKey({ provider, apiKey, apiKeys = {} }) {
  const key = apiKey || apiKeys[provider] || process.env[PROVIDERS[provider]?.envKey];
  if (!key) {
    throw new Error(`${provider} API key is required`);
  }
  return key;
}

export async function callModel({
  model,
  provider = inferProvider(model),
  apiKey,
  apiKeys,
  systemPrompt = '',
  messages,
  maxTokens = 8192,
  jsonMode = false,
}) {
  if (!provider || !PROVIDERS[provider]) {
    throw new Error(`Unable to infer provider for model "${model}"`);
  }
  const resolvedApiKey = resolveApiKey({ provider, apiKey, apiKeys });

  if (provider === 'anthropic') {
    return callAnthropic({ apiKey: resolvedApiKey, model, systemPrompt, messages, maxTokens });
  }
  if (provider === 'openai') {
    return callOpenAI({ apiKey: resolvedApiKey, model, systemPrompt, messages, maxTokens, jsonMode });
  }
  return callGemini({ apiKey: resolvedApiKey, model, systemPrompt, messages, maxTokens, jsonMode });
}

async function callAnthropic({ apiKey, model, systemPrompt, messages, maxTokens }) {
  const response = await fetch(PROVIDERS.anthropic.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt || undefined,
      messages: messages.map(message => ({
        role: message.role,
        content: normalizeTextContent(message.content),
      })),
    }),
  });
  return extractAnthropicText(await parseResponse(response));
}

async function callOpenAI({ apiKey, model, systemPrompt, messages, maxTokens, jsonMode }) {
  const input = [];
  if (systemPrompt) input.push({ role: 'developer', content: systemPrompt });
  for (const message of messages) {
    input.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: normalizeTextContent(message.content),
    });
  }

  const response = await fetch(PROVIDERS.openai.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      max_output_tokens: maxTokens,
      text: jsonMode ? { format: { type: 'json_object' } } : undefined,
    }),
  });
  return extractOpenAIText(await parseResponse(response));
}

async function callGemini({ apiKey, model, systemPrompt, messages, maxTokens, jsonMode }) {
  const response = await fetch(`${PROVIDERS.gemini.url}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      contents: messages.map(message => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: normalizeTextContent(message.content) }],
      })),
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: jsonMode ? 'application/json' : undefined,
      },
    }),
  });
  return extractGeminiText(await parseResponse(response));
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `Model request failed with status ${response.status}`);
  }
  return data;
}

function normalizeTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => part.text || String(part)).join('\n');
  }
  return String(content ?? '');
}

function extractAnthropicText(data) {
  return data.content?.find(part => part.type === 'text')?.text || '';
}

function extractOpenAIText(data) {
  if (data.output_text) return data.output_text;
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) return content.text;
    }
  }
  return '';
}

function extractGeminiText(data) {
  return data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
}
