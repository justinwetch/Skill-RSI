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

export const DEFAULT_MODEL_AUTHORING_RETRY_POLICY = {
  maxAttempts: 3,
  backoffMs: 250,
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

export function createModelAttemptError(message, {
  failureKind = 'model_error',
  rawResponse = null,
  status = null,
  statusClass = null,
} = {}) {
  const error = new Error(message);
  error.name = 'ModelAttemptError';
  error.failureKind = failureKind;
  error.rawResponse = rawResponse;
  error.status = status;
  error.statusClass = statusClass;
  return error;
}

export async function withModelRetry({
  phase,
  model,
  provider = inferProvider(model),
  maxAttempts = DEFAULT_MODEL_AUTHORING_RETRY_POLICY.maxAttempts,
  backoffMs = DEFAULT_MODEL_AUTHORING_RETRY_POLICY.backoffMs,
  operation,
}) {
  const attempts = [];
  const attemptLimit = normalizePositiveInt(maxAttempts, DEFAULT_MODEL_AUTHORING_RETRY_POLICY.maxAttempts);
  const delayMs = normalizeNonNegativeInt(backoffMs, DEFAULT_MODEL_AUTHORING_RETRY_POLICY.backoffMs);

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const startedAt = Date.now();
    try {
      const value = await operation({ attempt });
      if (typeof value === 'string' && !value.trim()) {
        throw createModelAttemptError('Model returned an empty response.', { failureKind: 'empty_response' });
      }
      return { ok: true, value, attempts, attemptCount: attempt };
    } catch (error) {
      const attemptRecord = createAttemptRecord({
        phase,
        model,
        provider,
        attempt,
        error,
        elapsedMs: Date.now() - startedAt,
      });
      attempts.push(attemptRecord);
      if (!shouldRetryAttempt(attemptRecord)) break;
      if (attempt < attemptLimit && delayMs > 0) {
        await sleep(delayMs + Math.floor(Math.random() * Math.min(100, delayMs)));
      }
    }
  }

  return {
    ok: false,
    attempts,
    attemptCount: attempts.length,
    lastError: attempts[attempts.length - 1] || null,
  };
}

export function summarizeModelAttempts(attempts = []) {
  const safeAttempts = Array.isArray(attempts) ? attempts : [];
  const lastError = safeAttempts[safeAttempts.length - 1] || null;
  return {
    attempts: safeAttempts,
    attemptCount: safeAttempts.length,
    lastError,
    failureKind: lastError?.failureKind || null,
  };
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
  tools = null,
  toolChoice = null,
  include = null,
  returnMetadata = false,
}) {
  if (!provider || !PROVIDERS[provider]) {
    throw new Error(`Unable to infer provider for model "${model}"`);
  }
  const resolvedApiKey = resolveApiKey({ provider, apiKey, apiKeys });

  if (provider === 'anthropic') {
    const text = await callAnthropic({ apiKey: resolvedApiKey, model, systemPrompt, messages, maxTokens });
    return returnMetadata ? { text, raw: null, provider } : text;
  }
  if (provider === 'openai') {
    return callOpenAI({ apiKey: resolvedApiKey, model, systemPrompt, messages, maxTokens, jsonMode, tools, toolChoice, include, returnMetadata });
  }
  const text = await callGemini({ apiKey: resolvedApiKey, model, systemPrompt, messages, maxTokens, jsonMode });
  return returnMetadata ? { text, raw: null, provider } : text;
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

async function callOpenAI({ apiKey, model, systemPrompt, messages, maxTokens, jsonMode, tools, toolChoice, include, returnMetadata }) {
  const input = [];
  if (systemPrompt) input.push({ role: 'developer', content: systemPrompt });
  for (const message of messages) {
    input.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: normalizeOpenAIContent(message.content),
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
      tools: Array.isArray(tools) && tools.length ? tools : undefined,
      tool_choice: toolChoice || undefined,
      include: Array.isArray(include) && include.length ? include : undefined,
    }),
  });
  const data = await parseResponse(response);
  const text = extractOpenAIText(data);
  if (!returnMetadata) return text;
  return {
    text,
    raw: data,
    provider: 'openai',
    webSearchCalls: extractOpenAIWebSearchCalls(data),
    sources: extractOpenAIWebSources(data),
    citations: extractOpenAICitations(data),
  };
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
    throw createModelAttemptError(
      data.error?.message || data.message || `Model request failed with status ${response.status}`,
      {
        failureKind: classifyHttpStatus(response.status),
        status: response.status,
        statusClass: `${Math.floor(response.status / 100)}xx`,
        rawResponse: typeof data === 'object' ? JSON.stringify(data) : String(data || ''),
      },
    );
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

function normalizeOpenAIContent(content) {
  if (!Array.isArray(content)) return normalizeTextContent(content);
  const parts = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push({ type: 'input_text', text: part });
      continue;
    }
    if (part?.type === 'input_text' && typeof part.text === 'string') {
      parts.push({ type: 'input_text', text: part.text });
      continue;
    }
    if (part?.type === 'input_image' && typeof part.image_url === 'string') {
      parts.push({ type: 'input_image', image_url: part.image_url });
      continue;
    }
    if (part?.imageUrl || part?.image_url) {
      parts.push({ type: 'input_image', image_url: part.imageUrl || part.image_url });
      continue;
    }
    parts.push({ type: 'input_text', text: part?.text || String(part ?? '') });
  }
  return parts;
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

function extractOpenAIWebSearchCalls(data) {
  return (data.output || []).filter(item => item.type === 'web_search_call');
}

function extractOpenAIWebSources(data) {
  const sources = [];
  for (const call of extractOpenAIWebSearchCalls(data)) {
    const actionSources = call.action?.sources || call.sources || [];
    if (Array.isArray(actionSources)) sources.push(...actionSources);
  }
  return sources;
}

function extractOpenAICitations(data) {
  const citations = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) {
        if (annotation.type === 'url_citation') citations.push(annotation);
      }
    }
  }
  return citations;
}

function extractGeminiText(data) {
  return data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
}

function createAttemptRecord({ phase, model, provider, attempt, error, elapsedMs }) {
  return {
    phase,
    attempt,
    model: model || null,
    provider: provider || null,
    name: error?.name || 'Error',
    message: sanitizeDiagnosticText(error?.message || String(error || 'Unknown model error')),
    failureKind: error?.failureKind || classifyError(error),
    status: error?.status || null,
    statusClass: error?.statusClass || null,
    rawResponse: truncateDiagnosticText(sanitizeDiagnosticText(error?.rawResponse || null), 20000),
    rawArtifact: sanitizeDiagnosticValue(error?.rawArtifact || null),
    elapsedMs,
  };
}

function shouldRetryAttempt(attempt) {
  return !['auth_error', 'api_request_error'].includes(attempt?.failureKind);
}

function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 408 || status === 409 || status === 425) return 'transient_http_error';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'transient_http_error';
  if (status >= 400) return 'api_request_error';
  return 'api_error';
}

function classifyError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('json')) return 'invalid_json';
  if (message.includes('empty response')) return 'empty_response';
  if (message.includes('api key') || message.includes('unauthorized') || message.includes('forbidden')) return 'auth_error';
  if (message.includes('rate limit') || message.includes('429')) return 'rate_limit';
  if (message.includes('fetch') || message.includes('network') || message.includes('timeout')) return 'transport_error';
  if (message.includes('schema') || message.includes('contract') || message.includes('valid')) return 'validation_error';
  return 'model_error';
}

function sanitizeDiagnosticText(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"***"')
    .replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"***"');
}

function sanitizeDiagnosticValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return sanitizeDiagnosticText(value);
  try {
    return JSON.parse(sanitizeDiagnosticText(JSON.stringify(value)));
  } catch {
    return null;
  }
}

function truncateDiagnosticText(value, maxLength) {
  if (typeof value !== 'string' || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
