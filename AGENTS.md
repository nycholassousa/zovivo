# AGENTS.md

Conventions and invariants for anyone — human or agent — working on this repo.
`CLAUDE.md` points here; this file is the source of truth.

## What this is

Zovivo is a [Zoia](https://github.com/caiomcg/zoia) addon. It watches a list of Twitch
streamers and keeps the chats it is bound to saying who is live: one message per streamer in
each chat, written when the stream starts, edited when its title or game changes, deleted
when it ends. The chat always reads as who is live now, not as a history.

It is one small loop. Once a minute it:

1. reads its settings and chats from Zoia (`GET /me`);
2. asks Twitch which of the list is live (`Get Streams`);
3. writes, edits and deletes messages until the chats agree.

It has no event stream, no commands, no storage and no run-time dependencies. Its only state
is the messages it wrote, in memory. Most of what it does not do is on purpose: see
[docs/adr](docs/adr) before adding any of it.

## Commands

```bash
npm install
npm test                     # node:test, against stand-ins for Zoia and Twitch
npm run test:zoia            # the real process against a real Zoia; needs a checkout, see below
npm run lint                 # eslint
npm run format               # prettier --write
npm run format:check         # prettier --check
node scripts/check-manifest.js   # the manifest, as far as Zoia's rules can be checked here
```

## Development environment

`npm run test:zoia` runs against Zoia's own app, so it needs a checkout of Zoia with its
dependencies installed, at `ZOIA_PATH` (`../zoia` when unset). Only Twitch is a stand-in. It
imports Zoia's test helpers, so a change to those can break it without the API changing.

Running it for real needs a Zoia server with the addon installed: set `ZOIA_URL` and
`ZOIA_ADDON_TOKEN`, as Zoia's addon host does in the container.

## Layout

| Path              | Holds                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `src/index.js`    | Starts it from the environment, runs the loop, retracts on the way out                      |
| `src/zovivo.js`   | The check: what to write, edit and delete, and the list of messages                         |
| `src/twitch.js`   | Twitch's API: the app token, and who of a list is live                                      |
| `src/zoia.js`     | Zoia's addon API, as far as Zovivo uses it                                                  |
| `src/messages.js` | The announcement, in each language                                                          |
| `zoia-addon.json` | The manifest: what the super admin is shown; its image and version are filled in at release |
| `scripts/`        | `check-manifest.js`: Zoia's manifest rules, for CI                                          |
| `test/`           | `*.test.js` against stand-ins; `zoia/` against a real Zoia                                  |
| `docs/adr/`       | Architecture decision records                                                               |

## Invariants — do not break these

1. **Not knowing is not offline.** When Twitch fails, `streams` throws and nothing changes.
   Treating a failure as an empty answer would delete every message at the first outage, and
   announce everyone again after it. `test/zovivo.test.js` guards this.
2. **Never ask Twitch for streams without logins.** With no `user_login`, `Get Streams`
   answers with the top of the whole site, and Zovivo would announce strangers. `check`
   returns first when the list is empty.
3. **Never log a secret.** Not the client secret, not a token, not a Zoia addon token, in no
   message and no error. Errors from Twitch carry a status, never the request.
4. **A message goes only when it is known to be gone.** A failed delete or edit stays to be
   tried at the next check. Only `404` and `not_bound` end it: those are out of reach for
   good. A failed write is not recorded, so it is retried too.
5. **Ask for as little as possible.** `chat.write` and `bots.create`, and nothing else. A
   release asking for one more needs the super admin's yes before it can update, and every
   server has to give it.
6. **No run-time dependencies.** The image is Node and `src/`, with no install step. A
   dependency is a reason to change the Dockerfile, not just `package.json`.
7. **Everything from Twitch is someone else's text.** Titles and game names go into the chat
   as they are, as plain text. They are never parsed, and never used in a replacement
   pattern: `$&` in a title must print as `$&`.

## Environment gotchas

Each of these fails in a way that looks like a bug in Zovivo:

- **`first` defaults to 20 at Twitch.** A list of more than twenty live at once loses the
  rest unless `first=100` is sent. `user_login` takes up to 100 per request, repeated, which
  is why logins go in pages.
- **The chat does not render Markdown.** `**bold**` shows its asterisks. Newlines and bare
  links work.
- **A bot cannot mention anyone.** Zoia stores every addon message with `mentions: []`, so
  `@name` in the body neither highlights nor notifies.
- **Addon messages are never events,** and there is no route that reads a chat. What it wrote
  cannot be recovered after a restart ([ADR 0001](docs/adr/0001-messages-kept-in-memory.md)).
- **Turning it off or updating it refuses its token first,** then stops the container. Its
  deletes on the way out are refused too, in exactly those cases.
- **Deploying Zoia does not restart it.** The addon host's containers keep running; checks
  fail while the app is down, and Zovivo carries on with what it remembers.
- **More than 50 requests in 10 seconds is a `429`** from Zoia. Writes and deletes run one at
  a time, and whatever is refused is retried at the next check.
- **A setting's value is at most 2000 characters,** which bounds the list.
- **The root filesystem is read-only.** Only `/tmp` can be written, and nothing survives a
  restart there.
- **`child.kill('SIGTERM')` on Windows ends the process outright,** without running its
  handler, which is why `test/zoia` triggers the signal from inside the process.

## Conventions

- **Conventional Commits**, enforced by commitlint in a hook and in CI. Scopes: `twitch`
  `zoia` `chat` `docs` `test` `adr` `ci`.
- ESM everywhere (`"type": "module"`). No build step.
- Tests use `node:test`. No test framework dependency.
- Decisions that a future reader would otherwise re-litigate go in `docs/adr/`.
- Comments say why. Code and documentation are in English; what the bot says is in Portuguese,
  English and Spanish, kept together in `src/messages.js`.
- A new setting goes in `zoia-addon.json` and in the README's table. Zoia refuses anything in
  the manifest it does not understand, so check it with `node scripts/check-manifest.js`.

## Releasing

A release is a `vX.Y.Z` tag on `main`. The workflow runs the checks, builds the image to
ghcr.io, writes its digest and the version into `zoia-addon.json`, and publishes a GitHub
release with that file attached, which is what Zoia installs.

1. `npm version <patch|minor|major> --no-git-tag-version`. The workflow refuses a tag that
   does not match `package.json`.
2. Commit it as `chore(release): X.Y.Z` and push `main`.
3. Wait for CI to pass, then `git tag vX.Y.Z && git push --tags`.
4. **The first release only:** ghcr.io makes a new package private, and the addon host pulls
   without credentials. On GitHub, open the package's settings and make it public.
5. The super admin updates it in Settings › Addons. **Updating while someone is live leaves
   their message behind** ([ADR 0001](docs/adr/0001-messages-kept-in-memory.md)), so it is
   worth doing when nobody on the list is.

The manifest's `id` can never change: Zoia refuses a release with another id as an update.
Never retag or delete a published release to fix it; ship the next patch version instead.
