/**
 * Preloaded into the real src/index.js by contract.test.js. Answers Twitch's
 * two addresses from a state file, and lets everything else, Zoia above all,
 * through to the real fetch. It also makes a check run every 200 ms instead of
 * every minute.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';

const realFetch = globalThis.fetch;
const json = (body) => new Response(JSON.stringify(body), { status: 200 });

globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (href.startsWith('https://id.twitch.tv/')) {
    return json({ access_token: 'stub', expires_in: 5000000, token_type: 'bearer' });
  }
  if (href.startsWith('https://api.twitch.tv/')) {
    const live = JSON.parse(readFileSync(process.env.STUB_STATE, 'utf8'));
    const asked = new URL(href).searchParams.getAll('user_login');
    return json({
      data: live
        .map((entry) => (typeof entry === 'string' ? { login: entry } : entry))
        .filter(({ login }) => asked.includes(login))
        .map(({ login, title, game }) => ({
          user_login: login,
          user_name: login.toUpperCase(),
          type: 'live',
          title: title ?? 'Título da live',
          game_name: game ?? 'Valorant',
        })),
      pagination: {},
    });
  }
  return realFetch(url, init);
};

const timers = createRequire(import.meta.url)('node:timers/promises');
const wait = timers.setTimeout;
timers.setTimeout = (_ms, value, options) => wait(200, value, options);
syncBuiltinESMExports();

// Windows has no SIGTERM to deliver; this reaches the same handler everywhere.
const poll = setInterval(() => {
  if (existsSync(`${process.env.STUB_STATE}.term`)) {
    clearInterval(poll);
    process.emit('SIGTERM');
  }
}, 25);
poll.unref();
