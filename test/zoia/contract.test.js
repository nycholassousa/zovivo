/**
 * Zovivo's real process against Zoia's real app, with only Twitch standing in,
 * and its manifest through Zoia's own validator: what the stand-ins in the
 * other tests can only assume. Needs a checkout of Zoia, with its dependencies
 * installed, at ZOIA_PATH (`../zoia` from here when unset).
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ZOVIVO = fileURLToPath(new URL('../..', import.meta.url));
const ZOIA = resolve(ZOVIVO, process.env.ZOIA_PATH ?? '../zoia', 'server');
const STUB = new URL('./twitch-stub.js', import.meta.url).href;

const zoiaFile = (path) => import(pathToFileURL(join(ZOIA, path)).href);

const { createApp } = await zoiaFile('src/app.js');
const { createStage } = await zoiaFile('src/stage.js');
const { validateManifest } = await zoiaFile('src/addons.js');
const { testStores } = await zoiaFile('test/people.js');
const { memoryMessages } = await zoiaFile('test/memory-messages.js');

const quiet = { info() {}, warn() {}, error() {} };

let dir;
let stores;
let messages;
let server;
let chat;
let addon;
let token;
let state;
let child;
let output;

const setLive = (streams) => writeFile(state, JSON.stringify(streams));
const inChat = () => messages.page({ chatId: chat.id, limit: 50 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(check, what, ms = 6000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timed out: ${what}\n${output}`);
    await pause(25);
  }
}

function runZovivo() {
  output = '';
  child = spawn(process.execPath, ['--import', STUB, 'src/index.js'], {
    cwd: ZOVIVO,
    env: {
      ...process.env,
      ZOIA_URL: `http://127.0.0.1:${server.address().port}`,
      ZOIA_ADDON_TOKEN: token,
      STUB_STATE: state,
    },
  });
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zovivo-contract-'));
  state = join(dir, 'live.json');
  await setLive([]);
  stores = testStores(join(dir, 'zoia.db'));
  await stores.chats.ready;
  messages = memoryMessages();
  const app = createApp({
    config: {
      sessionSecret: 'test-session-secret-long-enough',
      trustProxy: 1,
      secureCookies: false,
      roomName: 'zoia',
      rateLimit: { windowMs: 60_000, limit: 1000 },
      addons: { limit: { windowMs: 60_000, limit: 1000 } },
    },
    accountStore: stores.accounts,
    deviceStore: stores.devices,
    chatStore: stores.chats,
    addonStore: stores.addons,
    messageStore: () => messages,
    stage: createStage({
      rooms: { listParticipants: async () => [], updateParticipant: async () => {} },
      roomName: 'zoia',
      logger: quiet,
    }),
    logger: quiet,
  });
  server = app.listen(0);
  await once(server, 'listening');

  const raw = JSON.parse(await readFile(join(ZOVIVO, 'zoia-addon.json'), 'utf8'));
  raw.image = `ghcr.io/nycholassousa/zovivo@sha256:${'a'.repeat(64)}`;
  const checked = validateManifest(raw);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  ({ addon, token } = await stores.addons.install({
    repo: 'nycholassousa/zovivo',
    manifest: checked.manifest,
  }));
  await stores.addons.setEnabled(addon.id, true);
  chat = (await stores.chats.list())[0];
  await stores.addons.setBindings(addon.id, [chat.id]);
  const saved = await stores.addons.setSettings(addon.id, {
    streamers: 'ana, twitch.tv/Bia',
    twitchClientId: 'id',
    twitchClientSecret: 'secret',
  });
  assert.equal(saved.ok, true, JSON.stringify(saved));
});

afterEach(async () => {
  if (child?.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  server.closeAllConnections?.();
  server.close();
  await stores.db.idle();
  stores.db.close();
  await rm(dir, { recursive: true, force: true });
});

test('a live appears, stays once, and goes when it ends', async () => {
  await setLive(['ana']);
  runZovivo();
  await until(async () => (await inChat()).length === 1, 'announced');
  const [message] = await inChat();
  assert.equal(
    message.body,
    ['🔴 ANA está ao vivo: Valorant', 'Título da live', 'https://www.twitch.tv/ana'].join('\n'),
  );
  const bots = await stores.accounts.botsOf(addon.id);
  assert.equal(bots.length, 1);
  assert.equal(message.authorId, bots[0].id);

  await pause(700);
  assert.equal((await inChat()).length, 1, 'not announced twice');

  await setLive([]);
  await until(async () => (await inChat()).length === 0, 'deleted');
});

test('a change of settings applies without restarting', async () => {
  await setLive(['ana', 'caio']);
  runZovivo();
  await until(async () => (await inChat()).length === 1, 'ana only');

  await stores.addons.setSettings(addon.id, { streamers: 'caio' });
  await until(
    async () => (await inChat()).map((m) => m.body.split(' ')[1]).join() === 'CAIO',
    'ana gone, caio announced',
  );
});

test('a change of title edits the same message', async () => {
  await setLive(['ana']);
  runZovivo();
  await until(async () => (await inChat()).length === 1, 'announced');
  const [before] = await inChat();

  await setLive([{ login: 'ana', title: 'Novo título', game: 'Just Chatting' }]);
  await until(async () => (await inChat())[0]?.editedAt, 'edited');
  const after = await inChat();
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before.id);
  assert.equal(
    after[0].body,
    ['🔴 ANA está ao vivo: Just Chatting', 'Novo título', 'https://www.twitch.tv/ana'].join('\n'),
  );

  await setLive([]);
  await until(async () => (await inChat()).length === 0, 'deleted after the edit');
});

test('deleted by hand during the live, it is not written again', async () => {
  await setLive(['ana']);
  runZovivo();
  await until(async () => (await inChat()).length === 1, 'announced');
  const [message] = await inChat();
  await messages.remove({ chatId: chat.id, id: message.id });
  await setLive([{ login: 'ana', title: 'Novo título' }]);
  await pause(1000);
  assert.equal((await inChat()).length, 0);
  assert.doesNotMatch(output, /could not edit/);
});

test('asked to stop with its token good, it deletes what is up and exits 0', async () => {
  await setLive(['ana', 'bia']);
  runZovivo();
  await until(async () => (await inChat()).length === 2, 'both announced');
  await writeFile(`${state}.term`, '');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, output);
  assert.equal((await inChat()).length, 0, 'everything deleted on the way out');
});

test('turned off, its token is refused and the message stays (ADR 0001)', async () => {
  await setLive(['ana']);
  runZovivo();
  await until(async () => (await inChat()).length === 1, 'announced');
  await stores.addons.setEnabled(addon.id, false);
  await setLive([]);
  await pause(1500);
  assert.equal((await inChat()).length, 1);
  assert.match(output, /addon_disabled/);
});

test('killed while live, the old message stays and a second appears (ADR 0001)', async () => {
  await setLive(['ana']);
  runZovivo();
  await until(async () => (await inChat()).length === 1, 'announced');
  child.kill('SIGKILL');
  await once(child, 'exit');
  runZovivo();
  await until(async () => (await inChat()).length === 2, 'announced again');
  await setLive([]);
  await until(async () => (await inChat()).length === 1, 'only the new one deleted');
});

test('unbound from the chat, it can no longer delete, and forgets it', async () => {
  await setLive(['ana']);
  runZovivo();
  await until(async () => (await inChat()).length === 1, 'announced');
  await stores.addons.setBindings(addon.id, []);
  await setLive([]);
  await pause(1500);
  assert.equal((await inChat()).length, 1);
  assert.doesNotMatch(output, /could not delete/);
});
