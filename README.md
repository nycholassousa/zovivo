# Zovivo

A [Zoia](https://github.com/caiomcg/zoia) addon that says in a chat who is live on Twitch.
When a streamer on its list goes live, a message appears in the chats it is bound to; when
the stream ends, the message is deleted. Nothing is left behind, so the chat always reads as
who is live now.

```
🔴 Ana está ao vivo: Valorant
Ranked até subir
https://www.twitch.tv/ana
```

## Setting it up

1. **Make a Twitch application** at [dev.twitch.tv/console](https://dev.twitch.tv/console)
   (free; any name; `http://localhost` as its redirect URL; category "Other"). Copy its
   client ID, and make a new client secret.
2. **Make a chat** for it in Zoia, such as `#lives`.
3. **Install it.** The super admin opens **Settings › Addons**, enters
   `nycholassousa/zovivo`, reads what it asks for, and installs it. It asks to write in its
   chats as its bot, and to have a bot.
4. **Bind it to the chat**, and fill in its settings:

| Setting                     |                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Streamers                   | Twitch names or links, separated by spaces or commas: `gaules, alanzoka twitch.tv/casimito`. |
| Twitch client ID and secret | From step 1.                                                                                 |
| Language                    | What Zovivo writes in: Português, English or Español.                                        |

Only the super admin can change the list. A change applies at the next check, within a
minute; taking someone off the list deletes their message.

## When things happen

Zovivo checks Twitch once a minute, so a message may appear a minute or two after the stream
starts. It is deleted about three minutes after the stream ends, because a stream missing
from one check is often a dropped connection, and should not disappear and be announced
again. If Twitch cannot be reached, nothing changes until it can.

When a streamer changes the title or the game, the message is edited at the next check, and
Zoia marks it as edited. A message someone deleted by hand is not written again during that
stream.

## What it cannot do

**A message written before Zovivo restarts stays in the chat.** A Zoia addon has no storage
and cannot read a chat back, so the list of messages it wrote lives in memory, and goes with
it. If it crashes, is turned off or updated, or the machine restarts, while someone is live:

- their old message is never deleted, and an admin has to delete it by hand;
- once running again, Zovivo announces them a second time, and deletes only that one.

Asked to stop, it deletes its messages on the way out, but that only works while Zoia still
answers it: Zoia refuses its token before turning it off or updating it, and a machine
restarting may take Zoia down first. Deploying Zoia does not affect it, since Zovivo's
container keeps running through it.

Fixing this needs Zoia to give addons somewhere to keep data, which would also let people
add streamers from the chat with a command. See [docs/adr](docs/adr) for why it is built this
way.

## How it works

Zoia runs Zovivo in a container of its own, limited and with no access to Zoia's data.
It talks to Zoia through the [addon API](https://github.com/caiomcg/zoia/blob/main/docs/addons/api.md)
and to Twitch's [`Get Streams`](https://dev.twitch.tv/docs/api/reference/#get-streams). It
asks instead of being told because Twitch's webhooks need an address Zovivo could be reached
at, and an addon publishes none. It re-reads its settings and chats from Zoia at each check,
so it needs no event stream.

## Developing

```bash
npm install
npm test
npm run lint
```

There are no run-time dependencies. `npm run test:zoia` runs the real process against a real
Zoia, from a checkout at `ZOIA_PATH` (`../zoia` when unset). Running it for real needs a Zoia
server with the addon installed: set `ZOIA_URL` and `ZOIA_ADDON_TOKEN`.

Conventions, invariants and how to release are in [AGENTS.md](AGENTS.md).
