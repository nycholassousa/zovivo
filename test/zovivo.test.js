/**
 * The checks, against a stand-in Zoia and a stand-in Twitch: what is written,
 * what is deleted and when, and that nothing is lost when either fails.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createZovivo, parseStreamers } from '../src/zovivo.js';
import { announcement } from '../src/messages.js';
import { ZoiaError } from '../src/zoia.js';

const quiet = { info() {}, warn() {}, error() {} };

const ana = { login: 'ana', name: 'Ana', title: 'Ranked', game: 'Valorant' };
const bia = { login: 'bia', name: 'Bia', title: '', game: '' };

let me;
let written;
let deleted;
let edited;
let onLive;
let asked;
let refuseWrite;
let refuseEdit;
let refuseDelete;
let zovivo;

beforeEach(() => {
  me = {
    settings: {
      streamers: 'ana bia',
      twitchClientId: 'id',
      twitchClientSecret: 'secret',
      language: 'en',
    },
    chats: ['lives'],
    bots: [{ id: 'bot1', name: 'Zovivo' }],
  };
  written = [];
  deleted = [];
  edited = [];
  onLive = [];
  asked = [];
  refuseWrite = null;
  refuseEdit = null;
  refuseDelete = null;
  zovivo = createZovivo({
    zoia: {
      me: async () => me,
      createBot: async (name) => ({ id: 'made', name }),
      say: async (chatId, bot, body) => {
        if (refuseWrite) throw refuseWrite;
        const id = `m${written.length + 1}`;
        written.push({ id, chatId, bot, body });
        return { message: { id } };
      },
      edit: async (chatId, messageId, body) => {
        if (refuseEdit) throw refuseEdit;
        edited.push({ chatId, messageId, body });
      },
      unsay: async (chatId, messageId) => {
        if (refuseDelete) throw refuseDelete;
        deleted.push({ chatId, messageId });
      },
    },
    twitch: {
      streams: async (credentials, logins) => {
        asked.push({ credentials, logins });
        if (onLive instanceof Error) throw onLive;
        return new Map(onLive.map((s) => [s.login, s]));
      },
    },
    offlineChecks: 3,
    logger: quiet,
  });
});

describe('parseStreamers', () => {
  test('takes names and links, separated any way, each once', () => {
    const { logins, invalid } = parseStreamers(
      'Gaules, alanzoka;https://www.twitch.tv/Casimito/ twitch.tv/ana\n@bia gaules',
    );
    assert.deepEqual(logins, ['gaules', 'alanzoka', 'casimito', 'ana', 'bia']);
    assert.deepEqual(invalid, []);
  });

  test('sets aside what cannot be a Twitch name', () => {
    const { logins, invalid } = parseStreamers('ana https://example.com/x sem-traco');
    assert.deepEqual(logins, ['ana']);
    assert.deepEqual(invalid, ['https://example.com/x', 'sem-traco']);
  });

  test('is empty when the setting was never filled in', () => {
    assert.deepEqual(parseStreamers(undefined), { logins: [], invalid: [] });
  });
});

describe('announcing', () => {
  test('writes once per stream, as its bot, however many checks follow', async () => {
    onLive = [ana];
    await zovivo.check();
    await zovivo.check();
    await zovivo.check();
    assert.equal(written.length, 1);
    assert.equal(written[0].chatId, 'lives');
    assert.equal(written[0].bot, 'bot1');
    assert.equal(written[0].body, announcement('en', ana));
  });

  test('writes in every chat it is bound to, and in one bound later', async () => {
    me.chats = ['lives', 'geral'];
    onLive = [ana];
    await zovivo.check();
    assert.deepEqual(
      written.map((m) => m.chatId),
      ['lives', 'geral'],
    );
    me.chats = ['lives', 'geral', 'novo'];
    await zovivo.check();
    assert.deepEqual(
      written.map((m) => m.chatId),
      ['lives', 'geral', 'novo'],
    );
  });

  test('tries again at the next check when Zoia refuses the message', async () => {
    onLive = [ana];
    refuseWrite = new ZoiaError(503, 'chat_unavailable', '/chats');
    await zovivo.check();
    assert.equal(zovivo.live.size, 0);
    refuseWrite = null;
    await zovivo.check();
    assert.equal(written.length, 1);
  });

  test('makes its bot the first time, and keeps it after', async () => {
    me.bots = [];
    await zovivo.check();
    assert.equal(zovivo.bot.id, 'made');
    await zovivo.check();
    assert.equal(zovivo.bot.id, 'made');
  });

  test('passes the settings on to Twitch', async () => {
    await zovivo.check();
    assert.deepEqual(asked, [
      { credentials: { clientId: 'id', clientSecret: 'secret' }, logins: ['ana', 'bia'] },
    ]);
  });
});

describe('keeping it current', () => {
  const renamed = { ...ana, title: 'Agora é sério', game: 'Just Chatting' };

  beforeEach(async () => {
    onLive = [ana];
    await zovivo.check();
  });

  test('edits nothing while the stream says the same', async () => {
    await zovivo.check();
    await zovivo.check();
    assert.deepEqual(edited, []);
  });

  test('edits the message, once, when the title or the game changes', async () => {
    onLive = [renamed];
    await zovivo.check();
    await zovivo.check();
    assert.deepEqual(edited, [
      { chatId: 'lives', messageId: 'm1', body: announcement('en', renamed) },
    ]);
    assert.equal(written.length, 1);
  });

  test('edits every chat it wrote in', async () => {
    me.chats = ['lives', 'geral'];
    await zovivo.check();
    onLive = [renamed];
    await zovivo.check();
    assert.deepEqual(
      edited.map((e) => e.chatId),
      ['lives', 'geral'],
    );
  });

  test('rewrites the message when the language changes', async () => {
    me.settings.language = 'pt';
    await zovivo.check();
    assert.equal(edited[0].body, announcement('pt', ana));
  });

  test('tries the edit again while Zoia cannot do it', async () => {
    onLive = [renamed];
    refuseEdit = new ZoiaError(503, 'chat_unavailable', '/chats');
    await zovivo.check();
    refuseEdit = null;
    await zovivo.check();
    assert.equal(edited.length, 1);
  });

  test('does not write again a message someone deleted', async () => {
    onLive = [renamed];
    refuseEdit = new ZoiaError(404, 'not_found', '/chats');
    await zovivo.check();
    refuseEdit = null;
    await zovivo.check();
    assert.deepEqual(edited, []);
    assert.equal(written.length, 1);
  });

  test('still deletes the message after an edit', async () => {
    onLive = [renamed];
    await zovivo.check();
    onLive = [];
    for (let i = 0; i < 3; i += 1) await zovivo.check();
    assert.deepEqual(deleted, [{ chatId: 'lives', messageId: 'm1' }]);
  });
});

describe('taking it back', () => {
  beforeEach(async () => {
    onLive = [ana];
    await zovivo.check();
  });

  test('deletes the message after the stream has been gone for three checks', async () => {
    onLive = [];
    await zovivo.check();
    await zovivo.check();
    assert.deepEqual(deleted, []);
    await zovivo.check();
    assert.deepEqual(deleted, [{ chatId: 'lives', messageId: 'm1' }]);
    assert.equal(zovivo.live.size, 0);
  });

  test('keeps the message through a dropped connection', async () => {
    onLive = [];
    await zovivo.check();
    await zovivo.check();
    onLive = [ana];
    await zovivo.check();
    onLive = [];
    await zovivo.check();
    await zovivo.check();
    assert.deepEqual(deleted, []);
    assert.equal(written.length, 1);
  });

  test('announces again when they come back after it went', async () => {
    onLive = [];
    await zovivo.check();
    await zovivo.check();
    await zovivo.check();
    onLive = [ana];
    await zovivo.check();
    assert.equal(written.length, 2);
  });

  test('takes nobody for offline when Twitch cannot say', async () => {
    onLive = new Error('Twitch answered 503 for the streams');
    for (let i = 0; i < 5; i += 1) await zovivo.check().catch(() => {});
    assert.deepEqual(deleted, []);
    assert.equal(zovivo.live.size, 1);
  });

  test('deletes at once when they are taken off the list', async () => {
    me.settings.streamers = 'bia';
    await zovivo.check();
    assert.deepEqual(deleted, [{ chatId: 'lives', messageId: 'm1' }]);
  });

  test('deletes at once when the list is emptied, without asking Twitch', async () => {
    const before = asked.length;
    me.settings.streamers = '';
    await zovivo.check();
    assert.deepEqual(deleted, [{ chatId: 'lives', messageId: 'm1' }]);
    assert.equal(asked.length, before);
  });

  test('tries the delete again while Zoia cannot do it', async () => {
    onLive = [];
    refuseDelete = new ZoiaError(503, 'chat_unavailable', '/chats');
    for (let i = 0; i < 4; i += 1) await zovivo.check();
    assert.equal(zovivo.live.size, 1);
    refuseDelete = null;
    await zovivo.check();
    assert.deepEqual(deleted, [{ chatId: 'lives', messageId: 'm1' }]);
    assert.equal(zovivo.live.size, 0);
  });

  test('forgets a message someone already deleted', async () => {
    onLive = [];
    refuseDelete = new ZoiaError(404, 'not_found', '/chats');
    for (let i = 0; i < 3; i += 1) await zovivo.check();
    assert.equal(zovivo.live.size, 0);
  });

  test('forgets a message in a chat it was unbound from', async () => {
    onLive = [];
    refuseDelete = new ZoiaError(403, 'not_bound', '/chats');
    for (let i = 0; i < 3; i += 1) await zovivo.check();
    assert.equal(zovivo.live.size, 0);
  });

  test('retractAll deletes what is up, on the way out', async () => {
    await zovivo.retractAll();
    assert.deepEqual(deleted, [{ chatId: 'lives', messageId: 'm1' }]);
  });
});

describe('without what it needs', () => {
  test('asks Twitch nothing until the client ID and secret are set', async () => {
    delete me.settings.twitchClientSecret;
    await zovivo.check();
    assert.deepEqual(asked, []);
  });

  test('asks Twitch nothing with no streamers: it would list everyone', async () => {
    me.settings.streamers = '';
    await zovivo.check();
    assert.deepEqual(asked, []);
  });

  test('writes nowhere while it is bound to no chat', async () => {
    me.chats = [];
    onLive = [ana];
    await zovivo.check();
    assert.deepEqual(written, []);
  });
});

describe('announcement', () => {
  test('names the streamer, the game, the title and the link', () => {
    assert.equal(
      announcement('pt', ana),
      '🔴 Ana está ao vivo: Valorant\nRanked\nhttps://www.twitch.tv/ana',
    );
  });

  test('leaves out what the stream does not have', () => {
    assert.equal(announcement('es', bia), '🔴 Bia está en directo\nhttps://www.twitch.tv/bia');
  });

  test('takes a title and a game as they are', () => {
    const body = announcement('en', { ...ana, name: '$&', game: '$1', title: '{name}' });
    assert.equal(body, '🔴 $& is live: $1\n{name}\nhttps://www.twitch.tv/ana');
  });

  test('falls back to English', () => {
    assert.match(announcement('fr', ana), /is live/);
  });
});
