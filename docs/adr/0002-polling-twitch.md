# 2. Asking Twitch every minute, instead of being told

- **Status:** accepted
- **Date:** 2026-11-02

## Context

Twitch can push `stream.online` and `stream.offline` through EventSub, which is what a bot
would use anywhere else. It offers two transports, and neither fits an addon:

- **Webhooks** need a callback that uses SSL and listens on port 443. A Zoia addon publishes
  no port.
- **WebSockets** need a **user** access token: Twitch refuses an app access token there. That
  means someone signing in to Twitch and a token to keep refreshed, where the settings
  otherwise hold only an application's client ID and secret.

`Get Streams` takes an app access token, and up to 100 logins per request.

## Decision

**Zovivo asks `Get Streams` once a minute, with an app access token.** The check is a loop in
`src/index.js`, one at a time, so a slow one never overlaps the next.

**A stream must be missing from three checks in a row before its message goes.** A dropped
connection comes back within a minute or two, and should not delete the message and announce
the stream again.

**It re-reads `GET /me` at each check** rather than holding Zoia's event stream open. A check
already runs every minute, so a change of settings or chats applies within one, with no
stream to reconnect.

## Consequences

- A message appears a minute or two after a stream starts, and goes about three minutes after
  it ends. That is slower than a push would be, and accepted.
- A stream that ends and starts again within those three minutes keeps its message, which is
  then edited if its title or game changed.
- Each check costs one request to Zoia and one to Twitch per hundred logins, and more only
  when something changed.
- Saving a setting takes up to a minute to show.
