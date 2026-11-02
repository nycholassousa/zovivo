/**
 * Zovivo: one message per live streamer, in each chat it is bound to, deleted
 * when the stream ends.
 *
 * Everything it knows of what it wrote is here, in memory: a Zoia addon has
 * nowhere to keep it, and no way to read a chat back. A message written before
 * a restart can no longer be deleted, and the streamer is announced again.
 * On being stopped it deletes what it can, which is why `retractAll` exists,
 * but Zoia refuses its token before stopping it when it is turned off or
 * updated. See "What it cannot do" in the README.
 */

import { announcement } from './messages.js';

/** The bot's name, made unique by Zoia if it is taken. */
const BOT_NAME = 'Zovivo';
/**
 * Checks in a row a stream must be missing from before its message goes: a
 * dropped connection comes back within a minute or two, and should not delete
 * the message and announce the stream again.
 */
const OFFLINE_CHECKS = 3;

/** A message it can no longer touch: someone deleted it, or the chat was unbound. */
const outOfReach = (err) => err.status === 404 || err.code === 'not_bound';

/** How Twitch logins are spelled. */
const LOGIN = /^[a-z0-9_]{1,25}$/;

/**
 * The logins in the `streamers` setting: names or links, separated by spaces,
 * commas or semicolons. Each at most once.
 *
 * @returns {{ logins: string[], invalid: string[] }}
 */
export function parseStreamers(text = '') {
  const logins = new Set();
  const invalid = [];
  for (const word of text.split(/[\s,;]+/).filter(Boolean)) {
    const login = word
      .replace(/^(https?:\/\/)?((www|m)\.)?twitch\.tv\//i, '')
      .replace(/^@/, '')
      .replace(/\/$/, '')
      .toLowerCase();
    if (LOGIN.test(login)) logins.add(login);
    else invalid.push(word);
  }
  return { logins: [...logins], invalid };
}

export function createZovivo({ zoia, twitch, offlineChecks = OFFLINE_CHECKS, logger = console }) {
  let bot = null;
  /**
   * Who it has a message up for.
   * @type {Map<string, {
   *   messages: Map<string, { id: string, body: string }>,
   *   missed: number,
   * }>}
   */
  const live = new Map();
  const warned = new Set();

  /** Says something once: a check runs every minute, and the logs are read. */
  function warnOnce(message) {
    if (warned.has(message)) return;
    warned.add(message);
    logger.warn(`[zovivo] ${message}`);
  }

  /** Reuses its bot, which outlives the container; makes it the first time. */
  async function ensureBot(me) {
    bot ??= me.bots.find((b) => b.name.startsWith(BOT_NAME)) ?? me.bots[0] ?? null;
    if (bot) return;
    bot = await zoia.createBot(BOT_NAME);
    logger.info(`[zovivo] announcing as ${bot.name} (${bot.id})`);
  }

  /**
   * Deletes a streamer's messages. One that fails for now stays, to be tried
   * at the next check; one already gone, or in a chat it was unbound from, is
   * out of its reach and is forgotten.
   */
  async function retract(login) {
    const entry = live.get(login);
    if (!entry) return;
    for (const [chatId, { id }] of [...entry.messages]) {
      try {
        await zoia.unsay(chatId, id);
        entry.messages.delete(chatId);
      } catch (err) {
        if (outOfReach(err)) entry.messages.delete(chatId);
        else logger.warn(`[zovivo] could not delete the message for ${login}: ${err.message}`);
      }
    }
    if (entry.messages.size === 0) live.delete(login);
  }

  /**
   * Keeps a stream's messages saying what it says now. One that fails for now
   * is tried at the next check; one out of reach is left alone, and stays
   * known, so that a message someone deleted is not written again.
   */
  async function refresh(entry, body) {
    for (const [chatId, message] of entry.messages) {
      if (message.body === body) continue;
      try {
        await zoia.edit(chatId, message.id, body);
        message.body = body;
      } catch (err) {
        if (outOfReach(err)) message.body = body;
        else logger.warn(`[zovivo] could not edit a message in ${chatId}: ${err.message}`);
      }
    }
  }

  /** Brings a stream's messages up to date, and writes it where it is missing. */
  async function announce(stream, chats, language) {
    const entry = live.get(stream.login) ?? { messages: new Map(), missed: 0 };
    const body = announcement(language, stream);
    await refresh(entry, body);
    for (const chatId of chats) {
      if (entry.messages.has(chatId)) continue;
      try {
        const sent = await zoia.say(chatId, bot.id, body);
        entry.messages.set(chatId, { id: sent.message.id, body });
      } catch (err) {
        // Not kept, so the next check tries again.
        logger.warn(`[zovivo] could not write in ${chatId}: ${err.message}`);
      }
    }
    if (entry.messages.size > 0) live.set(stream.login, entry);
  }

  /**
   * One check: reads its settings and chats from Zoia, so a change applies
   * here without any event stream, and brings the chats up to date.
   */
  async function check() {
    const me = await zoia.me();
    await ensureBot(me);
    const settings = me.settings ?? {};

    const { logins, invalid } = parseStreamers(settings.streamers);
    if (invalid.length > 0) warnOnce(`not Twitch names, ignored: ${invalid.join(' ')}`);

    // Taken off the list: gone now, whatever Twitch says.
    for (const login of [...live.keys()]) {
      if (!logins.includes(login)) await retract(login);
    }
    if (logins.length === 0) return;

    const { twitchClientId: clientId, twitchClientSecret: clientSecret } = settings;
    if (!clientId || !clientSecret) {
      warnOnce('the Twitch client ID and secret are not set');
      return;
    }

    // If this throws, Twitch could not say: nobody is taken for offline.
    const streams = await twitch.streams({ clientId, clientSecret }, logins);

    for (const [login, entry] of live) {
      if (streams.has(login)) {
        entry.missed = 0;
      } else {
        entry.missed += 1;
        if (entry.missed >= offlineChecks) await retract(login);
      }
    }
    for (const stream of streams.values()) {
      await announce(stream, me.chats ?? [], settings.language);
    }
  }

  return {
    check,
    get live() {
      return live;
    },
    get bot() {
      return bot;
    },

    /** Deletes every message it has up, on the way out. */
    async retractAll() {
      for (const login of [...live.keys()]) await retract(login);
    },
  };
}
