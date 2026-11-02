/**
 * The Twitch client, against a stand-in for its HTTP API: the shape of what it
 * sends, per Twitch's reference, and what it makes of the answers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTwitch } from '../src/twitch.js';

const credentials = { clientId: 'the-id', clientSecret: 'the-secret' };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

const stream = (login, extra = {}) => ({
  user_login: login,
  user_name: login.toUpperCase(),
  title: 'A title',
  game_name: 'A game',
  type: 'live',
  ...extra,
});

/** A Twitch that hands out numbered tokens, and answers streams with `answer`. */
function fakeTwitch(answer) {
  const calls = { tokens: [], streams: [] };
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    if (href.startsWith('https://id.twitch.tv/oauth2/token')) {
      calls.tokens.push({ method: init.method, body: String(init.body) });
      return json({ access_token: `token${calls.tokens.length}`, token_type: 'bearer' });
    }
    assert.ok(href.startsWith('https://api.twitch.tv/helix/streams?'), href);
    const query = new URL(href).searchParams;
    calls.streams.push({ query, headers: init.headers });
    return answer(query, init.headers, calls.streams.length);
  };
  return { calls, twitch: createTwitch({ fetchImpl }) };
}

test('asks for a token as the client credentials flow does', async () => {
  const { calls, twitch } = fakeTwitch(() => json({ data: [] }));
  await twitch.streams(credentials, ['ana']);
  assert.equal(calls.tokens[0].method, 'POST');
  assert.equal(
    calls.tokens[0].body,
    'client_id=the-id&client_secret=the-secret&grant_type=client_credentials',
  );
});

test('asks for the logins, repeated, with its token and client ID', async () => {
  const { calls, twitch } = fakeTwitch(() => json({ data: [] }));
  await twitch.streams(credentials, ['ana', 'bia']);
  const [{ query, headers }] = calls.streams;
  assert.deepEqual(query.getAll('user_login'), ['ana', 'bia']);
  assert.equal(query.get('first'), '100');
  assert.equal(query.get('type'), 'live');
  assert.equal(headers.Authorization, 'Bearer token1');
  assert.equal(headers['Client-Id'], 'the-id');
});

test('answers the live ones by login, in lower case', async () => {
  const { twitch } = fakeTwitch(() => json({ data: [stream('Ana')] }));
  const live = await twitch.streams(credentials, ['ana']);
  assert.deepEqual(live.get('ana'), {
    login: 'ana',
    name: 'ANA',
    title: 'A title',
    game: 'A game',
  });
});

test('leaves out a stream Twitch does not call live', async () => {
  const { twitch } = fakeTwitch(() => json({ data: [stream('ana', { type: '' })] }));
  assert.equal((await twitch.streams(credentials, ['ana'])).size, 0);
});

test('keeps its token between checks', async () => {
  const { calls, twitch } = fakeTwitch(() => json({ data: [] }));
  await twitch.streams(credentials, ['ana']);
  await twitch.streams(credentials, ['ana']);
  assert.equal(calls.tokens.length, 1);
});

test('gets a new token when the credentials change', async () => {
  const { calls, twitch } = fakeTwitch(() => json({ data: [] }));
  await twitch.streams(credentials, ['ana']);
  await twitch.streams({ ...credentials, clientSecret: 'another' }, ['ana']);
  assert.equal(calls.tokens.length, 2);
});

test('gets a new token and tries again when Twitch refuses the one it has', async () => {
  const { calls, twitch } = fakeTwitch((_query, _headers, n) =>
    n === 1 ? json({}, 401) : json({ data: [stream('ana')] }),
  );
  const live = await twitch.streams(credentials, ['ana']);
  assert.equal(live.size, 1);
  assert.equal(calls.streams[1].headers.Authorization, 'Bearer token2');
});

test('gives up after one new token', async () => {
  const { calls, twitch } = fakeTwitch(() => json({}, 401));
  await assert.rejects(twitch.streams(credentials, ['ana']), /401/);
  assert.equal(calls.streams.length, 2);
});

test('asks in pages of a hundred logins', async () => {
  const { calls, twitch } = fakeTwitch((query) =>
    json({ data: [stream(query.getAll('user_login')[0])] }),
  );
  const logins = Array.from({ length: 250 }, (_, i) => `user${i}`);
  const live = await twitch.streams(credentials, logins);
  assert.deepEqual(
    calls.streams.map((c) => c.query.getAll('user_login').length),
    [100, 100, 50],
  );
  assert.deepEqual([...live.keys()], ['user0', 'user100', 'user200']);
});

test('throws, rather than answering nobody, when Twitch fails', async () => {
  const { twitch } = fakeTwitch(() => json({}, 503));
  await assert.rejects(twitch.streams(credentials, ['ana']), /503/);
});

test('throws, rather than answering nobody, on an answer without a list', async () => {
  const { twitch } = fakeTwitch(() => json({ error: 'odd' }));
  await assert.rejects(twitch.streams(credentials, ['ana']), /list/);
});

test('says the credentials were refused, without repeating them', async () => {
  const twitch = createTwitch({ fetchImpl: async () => json({}, 403) });
  await assert.rejects(twitch.streams(credentials, ['ana']), (err) => {
    assert.match(err.message, /client ID and secret/);
    assert.ok(!err.message.includes('the-secret'));
    return true;
  });
});
