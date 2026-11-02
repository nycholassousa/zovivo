# 1. What it wrote is kept in memory, and lost at restart

- **Status:** accepted
- **Date:** 2026-11-02

## Context

The point of Zovivo is that a message goes when the stream ends. Deleting a message takes its
id, so the ids have to outlive the stream, and a stream lasts hours.

A Zoia addon has nowhere to keep them. Its container has a read-only root and a `/tmp` that
does not survive a restart, with no volumes. The addon API has no storage, no route that reads
a chat, and sends no events for bots' messages, so what it wrote cannot be found again. It
cannot write its own settings either.

Three ways were weighed:

- **Storage in Zoia:** a `storage` permission and `GET`/`PUT /storage`, a small JSON document
  per addon. It solves this outright, and would make the list editable from the chat. It is a
  change to Zoia's public API, and needs a deployed server before the addon installs at all.
- **Storage elsewhere:** a JSON document in a private Gist or similar, with a token in the
  settings. No change to Zoia, but a dependency on a third party and on a token someone must
  keep alive, for what is a list of a few ids.
- **Memory:** nothing to set up, and it works on any Zoia server as it stands.

## Decision

**The ids are kept in memory, and nothing is stored.** Changing Zoia was decided against, for
now.

Zovivo deletes what it can when asked to stop (`retractAll`). This helps only while Zoia still
answers it, and costs a few lines.

## Consequences

- If it crashes, is turned off or updated, or the machine restarts, while someone is live,
  their message is never deleted, and an admin has to delete it by hand. Once running again,
  Zovivo does not know of it, announces them a second time, and deletes only that one.
- Turning it off or updating it is the worst case, and the most ordinary one: Zoia refuses the
  token first and then stops the container (`launch` and `/disable` in Zoia's
  `addon-admin.js`), so `retractAll` cannot help. Updating is best done with nobody live.
- Deploying Zoia costs nothing: the addon host's containers keep running through it, and
  Zovivo keeps what it remembers.
- A write that crashes before its id is kept is lost the same way. Nothing better is possible
  without storage, so it is not worked around.

If Zoia gains storage for addons, this record should be superseded: both the orphans and
[ADR 0003](0003-a-list-in-the-settings.md) come from its absence.
