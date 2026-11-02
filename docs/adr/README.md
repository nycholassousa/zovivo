# Architecture decision records

One file per decision that would otherwise be re-litigated, or re-discovered the hard way.
Each records the context at the time, what was chosen, and what it cost, including the
options that were weighed and dropped.

They are not updated as the system changes. A decision that stops being true gets a new
record that supersedes it, so the history stays legible.

| #                                       | Decision                                             | Status   |
| --------------------------------------- | ---------------------------------------------------- | -------- |
| [0001](0001-messages-kept-in-memory.md) | What it wrote is kept in memory, and lost at restart | accepted |
| [0002](0002-polling-twitch.md)          | Asking Twitch every minute, instead of being told    | accepted |
| [0003](0003-a-list-in-the-settings.md)  | The list is a setting: no commands, no mentions      | accepted |
