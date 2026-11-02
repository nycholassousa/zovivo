# 3. The list is a setting: no commands, no mentions

- **Status:** accepted
- **Date:** 2026-11-02

## Context

Commands to add and remove streamers from the chat, and a choice of being mentioned when
someone goes live, were both considered.

Either needs somewhere to keep what people chose, which an addon does not have
([ADR 0001](0001-messages-kept-in-memory.md)). Commands kept in memory would work until the
next restart or update, and then forget what people added, without saying so.

Mentions need a change to Zoia as well: its addon route stores every message with
`mentions: []`, so `@name` in the body neither highlights nor notifies.

## Decision

**The list of streamers is a text setting, which the super admin edits in Zoia.** It takes
names or links, separated by spaces, commas or semicolons, and is read again at each check.
Taking someone off the list deletes their message at once.

**Zovivo has no commands, and mentions nobody.** It asks only for `chat.write` and
`bots.create`.

It announces in every chat it is bound to, so where the messages go is the same decision a
super admin already makes for any addon, and needs no setting of its own.

## Consequences

- Only the super admin can change the list, as a server admin would on a Discord bot's
  dashboard. Nobody else needs to learn a command.
- The list is bounded by a setting's 2000 characters, which is well over a hundred names.
- If Zoia gains storage for addons, commands become possible. The rule then wanted is that
  anyone may add a streamer, and only whoever added them or an admin may remove them.
