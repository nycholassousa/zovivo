/**
 * Twitch's API, as Zovivo uses it: who of a list is live right now.
 *
 * Zovivo asks rather than being told. Twitch's webhooks need an address it
 * could reach, and a Zoia addon publishes none.
 */

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const STREAMS_URL = 'https://api.twitch.tv/helix/streams';
/** Logins Twitch takes in one request, and so also streams it answers with. */
const PAGE = 100;

/** A client that keeps its token until Twitch refuses it. */
export function createTwitch({ fetchImpl = fetch } = {}) {
  /** @type {{ key: string, token: string } | null} */
  let held = null;

  async function tokenFor({ clientId, clientSecret }) {
    const key = `${clientId}:${clientSecret}`;
    if (held?.key === key) return held.token;
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Twitch refused the client ID and secret (${res.status})`);
    const { access_token: token } = await res.json();
    held = { key, token };
    return token;
  }

  async function page(credentials, logins, retry = true) {
    const token = await tokenFor(credentials);
    const query = new URLSearchParams({ first: String(PAGE), type: 'live' });
    for (const login of logins) query.append('user_login', login);
    const res = await fetchImpl(`${STREAMS_URL}?${query}`, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': credentials.clientId },
      signal: AbortSignal.timeout(15_000),
    });
    // The token expired, or was revoked: a new one, once.
    if (res.status === 401 && retry) {
      held = null;
      return page(credentials, logins, false);
    }
    if (!res.ok) throw new Error(`Twitch answered ${res.status} for the streams`);
    const { data } = await res.json();
    if (!Array.isArray(data)) throw new Error('Twitch answered without a list of streams');
    return data;
  }

  return {
    /**
     * @param {{ clientId: string, clientSecret: string }} credentials
     * @param {string[]} logins never empty: without logins, Twitch lists everyone
     * @returns {Promise<Map<string, { login: string, name: string, title: string, game: string }>>}
     *   the live ones, by login. Throws when Twitch cannot say, which is not
     *   the same as nobody being live.
     */
    async streams(credentials, logins) {
      const live = new Map();
      for (let i = 0; i < logins.length; i += PAGE) {
        for (const stream of await page(credentials, logins.slice(i, i + PAGE))) {
          if (stream.type !== 'live') continue;
          const login = stream.user_login.toLowerCase();
          live.set(login, {
            login,
            name: stream.user_name,
            title: stream.title,
            game: stream.game_name,
          });
        }
      }
      return live;
    },
  };
}
