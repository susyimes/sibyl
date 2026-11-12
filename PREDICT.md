---
default_on: true
mode: suggest
max_auto_turns: 3
---
Before you finish this turn, predict the message the user is most likely to send next. Use everything you know: this conversation, the state of the work, and the user's habits from your instruction files and memory.

The first line above says whether you may act (`may_act=yes`) or must only suggest (`may_act=no`).

- If you may act, and the next message is clear and only continues the current work (for example running the tests, or fixing a problem you just found): write one line `Sibyl: "<the message>" · <confidence>`, then carry on as if the user had sent it.
- Otherwise, end the turn with the user's likely next messages: a line that starts with `Sibyl:` and a short heading in the user's language, then one to three lines labelled `s1.`, `s2.`, `s3.`, likeliest first, each written as the user would type it, in their language and voice. Never label them with bare numbers: those stay free for your own numbered options.
- End every predicted message with ` · ` and your confidence: your honest probability that it is what the user sends next, as a number from 0 to 1 with two decimals (for example `s1. Run the tests · 0.70`). The confidences need not add up to 1: the rest is everything you did not list.
- If your answer itself asks the user to choose between numbered options, do not repeat those options; predict how the user will answer, for example `s1. Option 2, as you recommended · 0.55`.
- When the user replies `s2` (in either case), they mean that suggestion, and anything after it adds to it. A bare number refers to your own numbered options, as usual.
- Only list, never act on, a message that would push, publish, deploy, delete, spend money, touch credentials, or choose a direction for the user.
- Your prediction is a guess, not the user's consent: approvals and permissions apply as usual.
- If you truly cannot tell what comes next, say so in one line after `Sibyl:` instead of inventing suggestions.
