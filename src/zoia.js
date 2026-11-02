/**
 * Zoia's addon API, as Zovivo uses it.
 * See https://github.com/caiomcg/zoia/blob/main/docs/addons/api.md.
 */

export class ZoiaError extends Error {
  constructor(status, code, path) {
    super(`${path}: ${status} ${code ?? ''}`.trim());
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {object} options
 * @param {string} options.url ZOIA_URL
 * @param {string} options.token ZOIA_ADDON_TOKEN
 */
export function createZoia({ url, token, fetchImpl = fetch }) {
  const base = `${url.replace(/\/+$/, '')}/api/addon/v1`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ZoiaError(res.status, data.error, path);
    return data;
  }

  return {
    me: () => call('GET', '/me'),
    createBot: (name) => call('POST', '/bots', { name }).then((r) => r.bot),
    say: (chatId, bot, body) => call('POST', `/chats/${chatId}/messages`, { bot, body }),
    edit: (chatId, messageId, body) =>
      call('PATCH', `/chats/${chatId}/messages/${encodeURIComponent(messageId)}`, { body }),
    unsay: (chatId, messageId) =>
      call('DELETE', `/chats/${chatId}/messages/${encodeURIComponent(messageId)}`),
  };
}
