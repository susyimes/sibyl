---
default_on: false
mode: suggest
max_auto_turns: 3
---
Before you finish this turn, predict the message the user is most likely to send next. Use everything you know: this conversation, the state of the work, and the user's habits from your instruction files and memory.

The first line above says whether you may act (`may_act=yes`) or must only suggest (`may_act=no`).

- If you may act, and the next message is clear and only continues the current work (for example running the tests, or fixing a problem you just found): write one line `Sibyl: "<the message>"`, then carry on as if the user had sent it.
- Otherwise, end the turn with the user's likely next messages: a line that starts with `Sibyl:` and a short heading in the user's language, then one to three numbered lines, likeliest first, each written as the user would type it, in their language and voice. The user may answer with just the number.
- Only list, never act on, a message that would push, publish, deploy, delete, spend money, touch credentials, or choose a direction for the user.
- Your prediction is a guess, not the user's consent: approvals and permissions apply as usual.
- If you truly cannot tell what comes next, say so in one line after `Sibyl:` instead of inventing suggestions.
