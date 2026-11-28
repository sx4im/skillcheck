// Forward only the text-completion fields used by the CLI. The deployment's
// model, reasoning mode, and completion count stay under server control.
import { NVIDIA_API_KEY, NVIDIA_BASE_URL, DEFAULT_MODEL } from './config.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import { isObject } from './http.js';

export const MAX_CHAT_BODY_BYTES = 512 * 1024;
const MAX_OUTPUT_TOKENS = 16000;
const CLI_DEFAULT_MODEL = 'openai/gpt-oss-120b';
const SUPPORTED_MODELS = new Set([DEFAULT_MODEL, CLI_DEFAULT_MODEL]);
const MESSAGE_ROLES = new Set(['system', 'developer', 'user', 'assistant']);
const LEGACY_FIELDS = ['extra_body', 'extra_headers', 'extra_query'];
const CHAT_FIELDS = new Set([
  'model', 'messages', 'max_tokens', 'temperature', 'stream', 'n', 'response_format',
  'chat_template_kwargs', ...LEGACY_FIELDS
]);

/**
 * @param {unknown} input
 * @returns {{ payload: Record<string, unknown> } | { message: string }}
 */
export function validateChat(input) {
  if (!isObject(input) || Object.keys(input).some((field) => !CHAT_FIELDS.has(field))) {
    return { message: 'Expected a JSON object with supported chat completion fields.' };
  }
  const { model, messages, max_tokens, temperature, stream, n, response_format, chat_template_kwargs } = input;
  if (typeof model !== 'string' || !SUPPORTED_MODELS.has(model)) {
    return { message: 'Use the hosted model configured for this deployment.' };
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 64 || !messages.every(validMessage)) {
    return { message: 'Provide 1–64 messages with a supported role and plain-text content.' };
  }
  if (max_tokens !== undefined && (typeof max_tokens !== 'number' || !Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > MAX_OUTPUT_TOKENS)) {
    return { message: `max_tokens must be an integer from 1 to ${MAX_OUTPUT_TOKENS}.` };
  }
  if (temperature !== undefined && (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    return { message: 'temperature must be a number from 0 to 2.' };
  }
  if ((stream !== undefined && stream !== false) || (n !== undefined && n !== 1)) {
    return { message: 'The hosted proxy supports a single non-streaming completion.' };
  }
  if (response_format !== undefined && (!isObject(response_format) || Object.keys(response_format).length !== 1 ||
    (response_format.type !== 'json_object' && response_format.type !== 'text'))) {
    return { message: 'response_format must be json_object or text.' };
  }
  if (chat_template_kwargs !== undefined && (!isObject(chat_template_kwargs) ||
    Object.keys(chat_template_kwargs).some((field) => field !== 'enable_thinking') ||
    ('enable_thinking' in chat_template_kwargs && typeof chat_template_kwargs.enable_thinking !== 'boolean'))) {
    return { message: 'chat_template_kwargs only accepts a boolean enable_thinking value.' };
  }
  if (LEGACY_FIELDS.some((field) => field in input && !isObject(input[field]))) {
    return { message: 'Legacy extra request fields must be JSON objects.' };
  }
  return {
    payload: {
      model: DEFAULT_MODEL,
      messages,
      stream: false,
      n: 1,
      max_tokens: max_tokens ?? 1024,
      temperature,
      response_format,
      chat_template_kwargs: { enable_thinking: false }
    }
  };
}

/** @param {unknown} message */
function validMessage(message) {
  return isObject(message) && Object.keys(message).length === 2 && typeof message.content === 'string' &&
    typeof message.role === 'string' && MESSAGE_ROLES.has(message.role);
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Promise<unknown>}
 */
export async function forwardChatCompletion(payload) {
  const upstream = await fetchWithTimeout(
    `${NVIDIA_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${NVIDIA_API_KEY}`,
        'content-type': 'application/json'
      },
      redirect: 'error',
      body: JSON.stringify(payload)
    },
    45000
  );
  if (!upstream.ok) {
    await upstream.body?.cancel();
    throw new Error('Model provider rejected the request.');
  }
  const response = await upstream.json();
  if (!isObject(response) || !Array.isArray(response.choices) || response.choices.length !== 1 ||
    'error' in response || JSON.stringify(response).includes(NVIDIA_API_KEY)) {
    throw new Error('Invalid model provider response.');
  }
  return response;
}
