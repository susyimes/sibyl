# Sibyl Specification (SPEC.md)

Status: Draft v0.5. The reference core passes the conformance cases. Grok CLI 1.0.77 installed Sibyl into itself from this file at L2 on 2026-11-12 and passed the acceptance in real turns.

**Off means off.**
- At L2, in a session where Sibyl is off, nothing reaches the model, nothing is shown, and nothing is written.
- Disabled (§7), at either level, Sibyl is taken out of the agent's configuration altogether: the agent behaves exactly as it did before installation.

Purpose: at the end of every turn, a coding agent predicts the message its user will most likely send next and shows that prediction in its own conversation. In `act` mode it may also carry on as if the user had sent it.

The agent observes itself: the same agent, in the same context, makes the prediction with everything it already knows. Sibyl adds only three things around it: a trigger that asks for the prediction, a switch, and a file of instructions.

> **Using this specification with an agent**
>
> `"Install Sibyl for yourself according to <the URL of this SPEC.md>."`
>
> The agent that receives this sentence does the whole job. It finds what its own environment offers, which may be a local CLI, a cloud agent, or an architecture nobody has described here. It then builds Sibyl into that environment, tests it, and reports the result, including when the build fails (§9).

Design principles, after https://github.com/susyimes/agent-coding-principle/blob/main/AGENT.md:
- The agent's own judgement makes the prediction. Nothing here limits what it may predict or how well it may think.
- The machinery stays small.
- Restrictions are explicit and can be switched off.
- Risk is flagged to the user, never hidden.
- Nothing leaves the environment beyond what the agent already sends to its own model.

## Normative language and sources

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT` and `MAY` are used as in RFC 2119.

Normative sources:
- this file;
- `conformance/cases.jsonl`, which fixes the behaviour of the decision (§5) and of reading `PREDICT.md` (§3);
- the default `PREDICT.md` in Appendix A. `./PREDICT.md` is the same text.

`reference/sibyl_core.mjs` is an executable reading of §3, §5.2 and §6. Where it disagrees with this file, this file governs and the difference is a bug.

---

## 1. Problem, goals and non-goals

**Problem.** People who work with coding agents type many follow-ups that could have been guessed: "run the tests", "commit and push", "go with what you recommended".

Sibyl's predecessor, intent-predict, guessed them from outside the session. That took several adapters, history sync, a separate model call, and a web page away from where the user types. The agent itself has the best information, so Sibyl moves the prediction inside it.

**Goals.**
1. At the end of each turn, the agent predicts the user's likely next messages and lists them in its own conversation. The user can answer with just a number.
2. In `act` mode, when the next step is clear and only continues the current work, the agent carries on by itself for a bounded number of steps.
3. Any agent, in any environment, can install Sibyl into itself from this file, test it, and explain a failure.

**Non-goals.**
- A second model or agent, an extra model call, a server, a web page, telemetry, or network access.
- Deciding what to predict. That is the agent's judgement, steered only by `PREDICT.md`.
- Instructions for particular tools. Finding the right mechanism in its own environment is the installing agent's job.

## 2. Overview

### 2.1 What the environment must provide

| # | Capability | Typical forms |
|---|---|---|
| C1 | A **turn-end trigger** that runs code when a turn genuinely ends, and can keep the agent working by handing it a reason. | A stop hook, a callback or middleware in the agent loop, a check at the end of the loop |
| C2 | **Per-session state** that survives from one turn to the next. | A file, a key-value store, a database row |
| C3 | A **place for `PREDICT.md`**, at the project level, the user level, or both. | Files, a settings store |
| C4 | An **input channel for `/predict`**. | A custom command or skill, or the ordinary message box |

Where the environment offers a command form that the model does not see (one only the user can invoke), C4 SHOULD use it. An installed command then costs nothing while Sibyl is off.

### 2.2 Levels

- **L2:** the environment has C1. Sibyl then runs at every genuine turn end, as described below.
- **L1:** there is no C1. Sibyl is then a paragraph in the agent's always-loaded instructions, adapted from the default body (Appendix A), asking it to end each turn with predictions. This is best effort: the agent may skip it, and there is no step counting. Every agent can reach at least L1, including one that cannot change its own harness.

At L1 the paragraph is read at every turn, so a session-level `off` only asks the agent to stop following it. To have no effect at all, use `disable` (§7), which removes the paragraph.

### 2.3 Flow at L2

```
the agent finishes a turn
 → the turn-end trigger (C1) runs the integration:
    load state (C2) and PREDICT.md (C3), call decide() (§5.2), save the returned state
    ├ allow     → the turn ends
    └ keep_open → the agent receives the reason: a one-line header, then PREDICT.md's body
         → it predicts the user's next message, in the same context:
            may_act=no, or the next step is unclear → ends the turn with 1–3 numbered suggestions
            may_act=yes and the next step is clear  → writes the prediction, carries on, ends again
                                                      (the trigger runs again)
```

## 3. `PREDICT.md`

**Location.** The integration uses the first of these that exists:
1. a project-level `PREDICT.md`, for example in the session's working directory;
2. a user-level `PREDICT.md`, for example `~/.sibyl/PREDICT.md`;
3. the built-in default (Appendix A), which is what the core uses when given no text.

The file SHOULD be read again at every turn end, so that edits take effect at once.

**Format.** YAML front matter between `---` lines, followed by a Markdown body.
- The front matter MUST be read as flat `key: value` lines, so that no YAML library is needed.
- A value may be wrapped in quotes and followed by a ` # comment`.
- Blank lines and lines starting with `#` are ignored. So are unknown keys.
- An invalid value falls back to its default, with a note.
- Front matter that is opened but never closed makes the whole file fall back to the defaults and the default body, with a note.
- A file without front matter is all body.
- An empty body falls back to the default body.
- A byte-order mark and CRLF line ends are accepted.
- Notes go into the reason (§5.2), so that the agent can tell the user.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `default_on` | `true` / `false` | `true` | Whether an interactive session that has not used `/predict` starts with Sibyl on. Sessions started non-interactively start off whatever this says (§5.3). |
| `mode` | `suggest` / `act` | `suggest` | `suggest` only lists predictions. `act` may also carry on by itself. |
| `max_auto_turns` | integer ≥ 0 | `3` | In `act` mode, the most steps taken by itself in a row before it must stop and list suggestions. |

**Body.** The body is the agent's whole brief when its turn is kept open. It SHOULD state goals and limits rather than steps, and it MUST keep the output conventions of §6.

## 4. Session state

The state of one session is:

```json
{ "on": true, "mode": "act", "count": 1, "updatedAt": 1800000000000 }
```

- `on` is the switch.
- `mode` is optional; when present it overrides `PREDICT.md` for this session.
- `count` is the number of times the current user turn has been kept open.
- `updatedAt` is the time of the last decision.

Where the state lives is the environment's choice (C2), keyed by the session's own id. Locally, `~/.sibyl/sessions/<id>.json` works; an id that is not a plain file name is hashed first. State untouched for 7 days MAY be deleted.

## 5. The turn-end decision

### 5.1 When

The trigger runs at the **genuine end of a turn**. Where the environment tells them apart, turns that were interrupted, refused, failed with an API error, or ended by shutdown are not decided on; they simply end.

### 5.2 The core: `decide`

The decision is a pure function, so that any implementation can be checked against `conformance/cases.jsonl`. `reference/sibyl_core.mjs` implements it.

**Input:**
- `event.continuing`: whether this end comes from a turn that was already kept open.
- `event.finalText`: the text of the agent's final message of the turn, or empty.
- `state`: the stored state, or `null` the first time the session is seen.
- `predict`: the text of the `PREDICT.md` in effect, or `null` for the built-in default.
- `pending`: a `/predict` request `{action: "on"|"off", mode?, at}` addressed to this session (§7), or `null`.
- `toolCap`: the environment's own limit on how often one turn may be kept open, or `null`.
- `now`: the current time in milliseconds.

**Output:**
- `decision`: `"allow"` or `"keep_open"`.
- `reason`: present only with `keep_open`.
- `save`: whether the state must be written.
- `state`: the state to write. When `save` is false, it is the input `state` untouched, possibly `null`, and nothing is written.
- `pending`: `"none"`, `"claimed"` or `"discarded"`.

```
decide(input):
  {config, body, notes} = parse(predict)                         (§3)
  state = copy of input.state, or {on: config.default_on, count: 0}
  an invalid count counts as 0
  (every return below that saves sets state.updatedAt = now)

  if pending:
    if now - pending.at < 120 s and pending.action is "on" or "off":
      state.on = (action == "on")
      for "on": state.mode = pending.mode if it is "suggest" or "act", else remove state.mode
      state.count = 0
      return allow, save, pending "claimed"   (the command's own turn is not predicted)
    pending result = "discarded"              (stale or malformed: delete it, do not apply it)

  if not state.on:   return allow, no save, input.state untouched     (off means off)
  if not event.continuing:               state.count = 0
  if delivered(event.finalText):         return allow, save
  mode   = state.mode or config.mode
  budget = 1 if mode == "suggest" else config.max_auto_turns + 1
  if toolCap is an integer >= 0:         budget = min(budget, toolCap)
  if state.count >= budget:              return allow, save
  state.count += 1
  may_act = (mode == "act") and (state.count < budget)
  return keep_open, save, reason = "[Sibyl] mode=<mode> may_act=<yes|no>"
                                   + one line per note + "\n\n" + body
```

- In `suggest` mode a user turn is kept open at most once.
- In `act` mode the agent may carry on up to `max_auto_turns` times. The last keep-open always has `may_act=no`, so the turn ends with suggestions.
- With a `toolCap` of 1, `act` behaves like `suggest`; with 0, nothing is kept open.

`delivered(text)` is true when a line matches `^\s*\**Sibyl\**\s*[:：]\s*(?=[^\s"“「『])`, case-insensitively and in multiline mode. That is a Sibyl line that does not open with a quote mark: suggestions, or "cannot tell" (§6).

### 5.3 What the integration does

1. **Fast path.** Load the pending request (§7) and the session's state first. If there is no pending request and the session is off, let the turn end at once. On the fast path, read nothing else (no transcript), write nothing, and output nothing.
   - A session never seen before starts as `default_on` says, with one exception. A session that the environment can tell was started non-interactively (a one-shot run, a script, another program driving the agent) starts off. Nobody is there to answer its suggestions, and an extra block could break a program that reads the output. The integration SHOULD detect this where the environment allows; `/predict on` still turns such a session on.
   - With the environment variable `SIBYL=off` set for the agent, the trigger MUST always take the fast path. Scripts and programs that drive an agent use it to keep Sibyl out of their runs.
2. Otherwise, map the environment's turn-end event to `decide`'s input. Read `finalText` from the event if it carries it, otherwise from the session's transcript; if neither is possible, pass it empty. Load the `PREDICT.md` text (C3).
3. Call `decide`. Write the returned state only when `save` is true. Delete the pending request if it was `claimed` or `discarded`. Do this before answering.
4. On `allow`, let the turn end. On `keep_open`, keep the agent working with `reason` as what it receives next.
5. **Fail open.** On any error (unreadable input, unavailable storage, a timeout), let the turn end, and SHOULD log one line where the user can find it.
6. Make no model call and no network request. Finish in well under a second; any timeout the environment lets you register SHOULD be at most 30 s.

The cost of Sibyl is the extra reasoning the agent does in a kept-open turn, inside a context it already has. There is no separate call.

## 6. Output conventions

These are what the agent writes. The default body asks for them, and `delivered` detects them.

- **Suggestions.**
  - A line that begins with `Sibyl:` and a short heading in the user's language. The heading MUST NOT open with a quote mark.
  - Then one to three lines labelled `s1.`, `s2.`, `s3.`, likeliest first. Each holds a message as the user would type it, in the user's language and voice.
  - Suggestions MUST NOT be labelled with bare numbers. Those stay free for the agent's own numbered options, so the two can appear together without confusion.
  - When the agent's answer itself asks the user to choose between numbered options, the suggestions predict how the user will answer instead of repeating the options, for example `s1. Option 2, as you recommended · 0.55`.
- **Confidence.** Every predicted message, in a suggestion or an acting line, ends with ` · ` and the agent's confidence: its honest probability that this is the message the user sends next, as a number from 0 to 1 with two decimals.
  - The confidences need not add up to 1; the remainder stands for everything not listed.
  - Sibyl sets no threshold. Whether to act stays the agent's judgement; the number makes that judgement visible.
- **Cannot tell.** A single line `Sibyl:` followed by a short statement, not opening with a quote mark. It counts as delivered.
- **Acting.** Before carrying on, a line that begins with `Sibyl:` followed by the predicted message in quote marks (`"…"`, `“…”` or `「…」`) and its confidence, for example `Sibyl: "Run the tests" · 0.85`. It does not count as delivered.
- **Replies.** A reply `s2` (in either case) means suggestion 2, and any text after it adds to it, as in `s2 and update the README too`. A bare number keeps its usual meaning: the agent's own numbered options.

## 7. The `/predict` command

| Form | Effect |
|---|---|
| `/predict on [suggest\|act]` | Turns Sibyl on for the session the command was typed in. With a mode, the session uses that mode; without one, it follows `PREDICT.md`. |
| `/predict off` | Turns it off for that session. |
| `/predict status` | Shows the level, which `PREDICT.md` is in effect and its settings, and what is known about the sessions that are on. |
| `/predict disable` | Takes Sibyl out of this agent's configuration everywhere: removes every registration it made (the turn-end trigger, the command, and at L1 the instruction paragraph). This installation's files and record stay where they are, unused. Other agents' installations are not affected (§12). |
| `/predict uninstall` | Disables Sibyl for this agent, then deletes this installation's files (§9.4). Shared files stay (§12). |

- `on` and `off` MUST affect only the issuing session. They switch predictions, not the installation: with `off`, the trigger still runs its fast path (§5.3).
- `disable` MUST leave the agent's configuration exactly as it was before installation, apart from changes others made since.
- **Re-enabling** after `disable` is done by giving the installation sentence again. The installer finds the record (§9.2) and only registers again, after checking the core still passes conformance.
- Once disabled, the `/predict` command is gone too. Uninstalling is then asked for in plain words, pointing the agent at the record, whose location the installation report gave (§9.4).
- The command SHOULD be offered in the environment's native form (C4). Where there is none, the same words sent as a message MUST work.

**When the command handler cannot tell which session it is in.** Write a pending request `{action, mode, at}` somewhere both the handler and the turn-end trigger can see. Scope it to where the command was issued; locally, that means keyed by working directory. The trigger that runs at the end of the same turn passes it to `decide`, which claims it (§5.2).

At L1, the agent follows these commands in the conversation itself.

## 8. Safety

- Installing Sibyl is the user's choice. Once installed, it starts on in `suggest` mode in interactive sessions; `act` is never on unless the user asks for it.
- `/predict off` per session, `default_on: false`, and `SIBYL=off` each turn it off. A non-interactive session starts off (§5.3).
- Off means off:
  - At L2, an off session gets nothing in its context, no output and no writes (§5.3).
  - At either level, `disable` removes Sibyl from the configuration entirely (§7).
- A predicted message is the agent's guess, not the user's consent. Approvals, permissions and sandboxing apply exactly as they would without Sibyl.
- The agent acts on a prediction only for continuations of the current work. It MUST only list, never act on, messages that would push, publish, deploy, delete, spend money, touch credentials, or choose a direction for the user.
- Steps taken by itself are bounded (§5.2), and the environment's own limit is respected.
- Installing and using Sibyl MUST NOT bypass anything the environment asks the user to approve or trust.
- The integration fails open (§5.3).

## 9. Installing

This section is addressed to the agent that installs Sibyl into its own environment.

### 9.1 Find the capabilities

Work out what your environment offers for C1–C4 (§2.1), and any limit on keep-opens (`toolCap`). Use whatever you can inspect: help output, documentation, configuration, source, or the framework you run in. Choose the level (§2.2), and tell the user which level is possible before changing anything.

### 9.2 Build

1. **The core.** Use `reference/sibyl_core.mjs` as it is, or port it to the language your environment runs. Either way it MUST pass every case in `conformance/cases.jsonl` (§10).
2. **The integration** (§5.3), registered with the turn-end trigger.
3. **The command** (§7).
4. **The default `PREDICT.md`** (Appendix A) at the user level, unless one is already there.

Put the files where §12 says: what concerns the user goes in the shared home; this installation's own files go under a folder of their own. When the home already exists, follow §12 before changing anything.

While building:
- Merge into existing configuration; never replace or reorder what is already there.
- Keep a record of every change you make, with how to undo it, and a copy of each file as it was before you changed it. Keep the record with Sibyl's own files: `disable`, re-enabling and `uninstall` all work from it.
- If a record of a disabled installation already exists, re-enable from it (§7) instead of building again.
- When the environment requires the user to approve or trust something, stop and ask the user. Do not work around it.

At L1, add the instruction paragraph to your always-loaded instructions instead, between clearly marked Sibyl start and end comments, and record that.

### 9.3 Acceptance

Sibyl is installed only when all of these hold:

1. **Conformance.** The core you run passes every case in `conformance/cases.jsonl`. With the reference core, `node conformance/run.mjs` prints `SIBYL CONFORMANCE: PASS`. A port is checked by a runner of your own that follows §10.
2. **The real environment.** Each of these is observed in real turns:
   - with Sibyl off, a turn ends normally, nothing of Sibyl's appears in it, and the state store is left unchanged;
   - after `/predict on`, the next turn ends with a `Sibyl:` block of numbered suggestions;
   - a new user message starts the count again, so that turn is also kept open once;
   - with the state store made unavailable, a turn still ends normally (fail open), and works again once the store is restored;
   - with `SIBYL=off` set, a turn in a session that would otherwise be on ends with nothing of Sibyl's in it and nothing written.
3. **Disable and re-enable.**
   - After `/predict disable`, every configuration file Sibyl changed is identical to its pre-installation copy, apart from changes others made since.
   - A turn then behaves as it did before installation.
   - Giving the installation sentence again brings Sibyl back.

At L1, item 2 is reduced to the `/predict on` check and is best effort; item 3 applies in full.

### 9.4 Report and uninstall

**On success, tell the user:**
- the level reached;
- what you used for C1–C4, and what you changed;
- the acceptance results;
- that Sibyl is now on in `suggest` mode for new interactive sessions, and off in non-interactive ones;
- how to turn it off and on per session, how to keep it off by default (`default_on: false`) or out of a script (`SIBYL=off`), and how to disable it everywhere and bring it back;
- where the record of changes is kept, and how to uninstall.

**On failure:**
- undo what you changed;
- tell the user which step failed and why, and what was undone;
- tell them what still works, for example L1 if they agree;
- tell them what would be needed for L2.

Do not leave a half-installed trigger behind.

**Uninstall** disables Sibyl for this agent (§7), then deletes this installation's own files and record, and removes it from the registry (§12). Shared files stay while any other installation remains. When the last installation goes, the user-level `PREDICT.md` and any module data are kept unless the user asks for them to be deleted.

## 10. Conformance cases

`conformance/cases.jsonl` has one JSON object per line. Each has an `id`, a `note`, and one of three inputs:

| Input | Call | `expect` |
|---|---|---|
| `"decide": {…}` | `decide(input)` | `decision`; `save`; optional `reason` (exact), `reasonStartsWith`, `reasonIncludes` (list); `state`: `null` (the output state must be `null`), or an object whose listed fields must be equal (others, such as `updatedAt`, are not checked unless listed); optional `stateLacks` (fields that must be absent); `pending` |
| `"parse": text or null` | read `PREDICT.md` text (§3) | `config` (all three settings, exactly); `notes` (how many); optional `body` (exact, after trimming) or `bodyStartsWith` |
| `"delivered": text` | `delivered(text)` | `true` or `false` |

A port passes when every case gives what `expect` says. `node conformance/run.mjs` runs the cases against the reference core; that is the check an installation uses.

In this repository, `node conformance/run.mjs --repo` also checks that the default template is the same in the core, in `./PREDICT.md` and in Appendix A. An installed copy MUST NOT depend on that check, because its `PREDICT.md` is the user's own and may differ.

## 11. Optional modules

A module extends an installation without changing this specification or the reference core.

- Each module has its own specification, installation sentence, conformance cases, and acceptance.
- A module is installed only on top of an installed base, and only by the user's choice.
- It may add keys to `PREDICT.md`, which the base ignores, and forms to `/predict`.
- Its changes go into the base's record, marked as the module's.
- Disabling the base (`/predict disable`) takes its modules out too. Uninstalling a module leaves the base as it was.

| Module | Specification | What it adds |
|---|---|---|
| Evolution | [evolve/SPEC.md](evolve/SPEC.md) | A local journal of the user's replies to predictions, statistics, and learning turns whose notes accompany later predictions |

## 12. The shared home

Sibyl's files are about a user, not about one agent. Every installation for the same user on the same machine SHOULD share one home, locally `~/.sibyl/`. The user's settings, session switches and, with the evolution module, their journal and learned notes then follow them from agent to agent.

```
~/.sibyl/
  sibyl.json             the registry: {"layout": 1, "agents": {"<agent>": {"dir": "agents/<agent>", "level": "L2", "enabled": true}}}
  PREDICT.md             the user's settings and notes                         shared
  sessions/<id>.json     session states (agents' session ids do not collide)  shared
  journal.jsonl          the evolution module's journal                       shared
  LEARNED.md             the evolution module's notes                         shared
  agents/<agent>/        one installation: its integration, its copies of the cores, its record, its log
```

**Shared files belong to the user.**
- An installer MUST NOT overwrite or delete them, except as §9.4 allows.
- When an installation rewrites a session state, it MUST keep fields it does not know; other installations and modules may have put them there.
- Writes SHOULD be atomic: write a temporary file, then rename it. A journal record SHOULD be appended in a single write.

**Each installation keeps to its own folder.** Its integration, its copies of the cores and its record live under `agents/<agent>/`. One agent upgrading its copies then cannot change another agent's behaviour.

**When the home already exists**, the installer looks before changing anything:

| What is there | What to do |
|---|---|
| A `sibyl.json` | A Sibyl home. Add yourself to the registry and reuse the shared files as they are. If you are already registered, re-enable or upgrade your own folder instead of installing again. |
| Sibyl's files but no `sibyl.json`: an earlier installation that kept its files at the top level | Still a Sibyl home. Write `sibyl.json`, registering the earlier installation where it is (`"dir": "."`). Do not move its files, because its registrations point at them. Tell the user. |
| Anything else: a folder Sibyl did not make | Do not touch it. Stop and ask the user for another location, or report that you could not install. |
| A user-level `PREDICT.md` that differs from the current default | Keep it. If the current default has something it lacks that matters, such as a newer output convention, tell the user and let them decide. |

**Two installations, one trigger.** Some environments also run triggers registered for another tool. For example, an agent may read another tool's settings file. If your environment would also run an existing installation's trigger, do not register a second one there; say how you resolved it.

**Removing.**
- `disable` and `uninstall` act on the issuing agent's installation only: its registrations and its folder. They also update the registry.
- `/predict status` SHOULD list every installation in the registry.

---

## Appendix A. Default `PREDICT.md`

This is the built-in default (§3) and the file the installer places at the user level. `./PREDICT.md` holds the same text.

```markdown
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
```
