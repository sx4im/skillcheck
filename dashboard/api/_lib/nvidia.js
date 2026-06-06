// Forwards an OpenAI-compatible chat-completion to the upstream provider using
// the server-side NVIDIA key. The hosted tier pins the model for cost control.

import { NVIDIA_API_KEY, NVIDIA_BASE_URL, DEFAULT_MODEL } from './config.js';

export async function forwardChatCompletion(body) {
  const payload = { ...body, model: DEFAULT_MODEL, stream: false };
  const upstream = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${NVIDIA_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const text = await upstream.text();
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type') || 'application/json',
    text
  };
}
