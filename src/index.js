/**
 * Starts Zovivo in its container, with what Zoia's addon host put in its
 * environment, and checks Twitch every minute until it is told to stop.
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { createTwitch } from './twitch.js';
import { createZoia } from './zoia.js';
import { createZovivo } from './zovivo.js';

const { ZOIA_URL, ZOIA_ADDON_TOKEN } = process.env;
if (!ZOIA_URL || !ZOIA_ADDON_TOKEN) {
  console.error('ZOIA_URL and ZOIA_ADDON_TOKEN are set by Zoia’s addon host; run Zovivo there.');
  process.exit(1);
}

const CHECK_MS = 60_000;

const zovivo = createZovivo({
  zoia: createZoia({ url: ZOIA_URL, token: ZOIA_ADDON_TOKEN }),
  twitch: createTwitch(),
});

const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop.abort());

while (!stop.signal.aborted) {
  await zovivo.check().catch((err) => console.warn(`[zovivo] ${err.message}`));
  await sleep(CHECK_MS, undefined, { signal: stop.signal }).catch(() => {});
}

await zovivo.retractAll();
process.exit(0);
