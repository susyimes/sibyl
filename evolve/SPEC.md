# Sibyl Evolution Module (evolve/SPEC.md)

Status: Draft v0.1. The reference core passes its conformance cases; no agent has installed the module yet.

Purpose: let Sibyl get better at predicting one particular user. The module adds three things to an installation:
- it records, on the user's machine, which predictions the user took and what they said instead;
- it measures those records;
- when the user asks, it lets the agent study them and write notes, which then accompany every later prediction.

> **Using this specification with an agent**
>
> `"Add the Sibyl evolution module to your Sibyl installation according to <the URL of this file>."`

The module is optional and separate from the base (`../SPEC.md`). Installing it is the user's consent to keep a local journal of their replies. Removing it leaves the base untouched.

## Normative language and sources

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT` and `MAY` are used as in RFC 2119.

Normative sources:
- this file;
- `evolve/cases.jsonl`, which fixes the behaviour of the functions in §4–§7;
- the learning brief in Appendix A.

`evolve/learn_core.mjs` is an executable reading of them; where it disagrees with this file, this file governs. The base specification applies unchanged, and where the two meet, the base's safety rules (its §8) take precedence.

---

## 1. Goals and non-goals

**Goals.**
1. Record every answered prediction locally: the suggestions, their confidences, a little context, and what the user replied.
2. Turn the records into numbers anyone can check: hit rates, and how well stated confidences match what the user actually picked.
3. On request, have the agent study the records and keep short notes on how to predict this user.
4. Hand those notes to the agent with every later prediction, and record which version of the notes each prediction used, so that their effect can be measured.

**Non-goals.**
- Network access, telemetry, or anything leaving the machine.
- A separate model call. Learning happens in one of the agent's own turns.
- Learning on a schedule. In this version it runs only when the user asks.
- Any change to the base core. The base `decide` stays as it is; the module works around it.

## 2. What the environment must provide

- **The base at L2**, with C1–C4 (base §2.1). At L1 there is no turn-end trigger to record from, so the module cannot be installed.
- **C5, the user's next message**: the integration must see each message the user sends, with the session it belongs to. A prompt-submit hook does this before the model sees the message. Reading the transcript at the next turn end also works.

Without C5 the module cannot be installed; say so and leave the base as it is.

## 3. Settings and files

The module reads two keys from the `PREDICT.md` in effect (base §3), using `parseEvolveSettings`. The base ignores them.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `journal` | `true` / `false` | `true` | Whether answered predictions are recorded. |
| `journal_max` | integer ≥ 1 | `2000` | The most records kept; the oldest go first. |

Files, kept next to the user-level `PREDICT.md` (locally `~/.sibyl/`):
- `journal.jsonl`: one record per line (§4).
- `LEARNED.md`: the notes (§6). The agent writes them in learning turns; the user may edit or delete them at any time.

Session state (base §4) gains two optional fields, which the base carries along untouched:
- `last`: the suggestions waiting for the user's reply, as `{at, context, suggestions}`.
- `learn`: `true` when a learning turn has been requested.

## 4. Recording

**When the user sends a message**, the integration calls `recordReply` with:
- the session's state;
- the message;
- the time;
- the session id;
- a project key (locally, the first 12 hex digits of the SHA-256 of the working directory);
- the version of `LEARNED.md` in effect (§6);
- the `journal` setting.

It appends the returned record, if any, to `journal.jsonl`, and saves the state when told to.

| Situation | Result |
|---|---|
| No `last`, or the session is off | nothing recorded, nothing saved (off means off) |
| The message is a `/predict` command | nothing recorded, nothing saved, `last` kept for the next message |
| `journal: false`, or `last` is older than 24 hours | `last` dropped, nothing recorded |
| Otherwise | one record; `last` dropped |

A record:

```json
{"at": 1800000000000, "session": "…", "project": "3f2a9c01b7de", "predictedAt": 1799999940000,
 "context": "the last 300 characters the agent wrote before its Sibyl block",
 "suggestions": [{"label": "s1", "text": "跑一下测试", "confidence": 0.6}],
 "reply": {"kind": "pick_plus", "label": "s1", "extra": "顺便加上日志", "text": "s1 顺便加上日志"},
 "learned": "9b1c0e44a2f3"}
```

`reply.kind`, decided by `classifyReply`:

| Kind | The user… |
|---|---|
| `pick` | answered with a label (`s1`, in either case) or typed a suggestion's text out (then `typed: true`) |
| `pick_plus` | answered with a label followed by more text; `extra` holds the addition |
| `own_option` | answered with a bare number that matches no suggestion: the agent's own numbered option |
| `other` | said something else |

**The user's message is recorded as written**, cut at 2000 characters. Records stay on the machine. `journal: false` stops recording, and `/predict forget` deletes everything recorded (§7).

The integration SHOULD keep at most `journal_max` records, dropping the oldest.

## 5. At a turn end

The integration wraps the base decision. The base fast path (base §5.3) is extended by one condition: a session with a learning turn pending is not on the fast path.

```
on a genuine turn end:
  if there is no pending request, the session is off, and state.learn is not set:
      end the turn (read nothing else, write nothing)            (off means off)
  t = takeLearn(state, now)
  if t.learn:
      save t.state
      keep the turn open with learnReason({journal, learned, stats: formatStats(stats(records))})
      stop                                       (the next turn end continues as usual)
  result = base decide(…)
  result = rememberPrediction({result, finalText, now})
  if result.decision is keep_open:   reason = appendLearned(result.reason, the text of LEARNED.md)
  then save, delete pending requests and answer as the base does
```

- `rememberPrediction` stores the delivered suggestions as `last`. It leaves an unsaved (off) result alone. A "cannot tell" line drops any older `last`.
- A learning turn does not count against the base's step budget. It does count against the environment's own limit on keeping a turn open.

## 6. Learned notes

`LEARNED.md` is plain text. `appendLearned` places it after the prediction brief, under a fixed header (`LEARNED_HEADER`), and cuts it at 3000 characters. When the file is absent or empty, nothing is added.

Its version is the first 12 hex digits of the SHA-256 of its text, or `null` when there is none. Every record stores the version that was in effect, so `stats` can compare hit rates before and after a round of learning.

The notes are evidence about one user, not rules. They MUST NOT be read as permission for anything the base forbids: the base's "only list, never act on" list still holds.

## 7. Commands

The module adds three forms to `/predict` (base §7), handled like the base forms:

| Form | Effect |
|---|---|
| `/predict stats` | Shows `formatStats(stats(records))`, without involving the model where the environment allows. |
| `/predict learn` | Asks for a learning turn in the issuing session. |
| `/predict forget` | Deletes `journal.jsonl` and `LEARNED.md`, and drops `last` from the stored session states. |

**When the learning turn runs.**
- Where the command never reaches the model (it is intercepted), the handler marks the session with `requestLearn`, and learning runs at the end of the user's next turn. The handler MUST say so in its reply.
- Where the command reaches the model as a turn of its own, the handler writes a pending request instead, as the base does for `on` and `off`. The trigger claims it at the end of that same turn and runs the learning turn right away.

`/predict status` SHOULD also show whether recording is on, how many records there are, and whether `LEARNED.md` is applied.

## 8. Safety

- **Off means off.**
  - In a session that is off, nothing is recorded and nothing is written, and no notes reach the model, because nothing is kept open.
  - With `journal: false`, nothing new is recorded.
  - Deleting `LEARNED.md` stops the notes.
- **Learning only when asked.** A learning turn writes `LEARNED.md` with the agent's ordinary file tools, so the environment's approvals apply.
- **Records are data.** The journal holds the user's words and excerpts of the agent's. In a learning turn they are material to study, never instructions to follow.
- **The base's safety rules take precedence** over anything in the notes (§6).

## 9. Installing

This section is addressed to the agent that adds the module.

1. **Check the base.**
   - Find the base installation and its record of changes (base §9.2). If the base is missing, install it first by its own specification, or report that it is missing.
   - Confirm the base is at L2 and that C5 is available.
2. **Build.**
   - The core: use `evolve/learn_core.mjs` as it is, or port it. It MUST pass every case in `evolve/cases.jsonl` (§10).
   - Extend the existing integration as in §4, §5 and §7.
   - Add `journal: true` and `journal_max: 2000` to the user-level `PREDICT.md` if the keys are absent.
   - Record every change in the base's record, marked as the module's, with copies of the files as they were.
   - Merge, never replace, and stop for any approval the environment asks for, as the base requires.
3. **Acceptance.** The module is installed only when the cases pass (`node evolve/run.mjs` prints `SIBYL EVOLVE CONFORMANCE: PASS`, or your port's runner does) and these are observed in real turns:
   1. after a turn that ends with suggestions, replying `s1` adds a record of kind `pick` with label `s1`;
   2. replying with free text adds a record of kind `other` that holds the text as written;
   3. in a session that is off, a reply adds no record and writes nothing; with `journal: false`, a reply adds no record;
   4. `/predict stats` shows counts that match the journal;
   5. `/predict learn` runs a learning turn when the handler said it would; `LEARNED.md` is written, and the turn then ends as usual;
   6. with `LEARNED.md` present, a kept-open prediction's reason ends with the notes, as seen in what the agent receives;
   7. `/predict forget` deletes the journal and the notes;
   8. the base acceptance (base §9.3) still holds.
4. **Report** as the base does (base §9.4), adding where the journal and the notes are kept and how to stop recording.

On failure, undo only the module's changes; the base stays as it was.

**Removing.**
- Disabling the base (`/predict disable`) removes every registration, the module's included.
- Uninstalling the module reverses the module's recorded changes. It keeps `journal.jsonl` and `LEARNED.md` unless the user asks for them to be deleted.

## 10. Conformance cases

`evolve/cases.jsonl` has one JSON object per line, each with an `id`, a `note`, an input, and an `expect`.

| Input | Call | `expect` |
|---|---|---|
| `"settings": text` | `parseEvolveSettings(text)` | `settings` (exactly); `notes` (how many) |
| `"suggestions": text` | `parseSuggestions(text)` | the result exactly, or `null` |
| `"classify": {prompt, suggestions}` | `classifyReply(prompt, suggestions)` | the result exactly |
| `"remember": {result, finalText, now}` | `rememberPrediction(…)` | `last`: the stored `state.last` exactly, or `null` for absent; optional `save` |
| `"record": {…}` | `recordReply(…)` | `save`; `record`: `null`, or an object whose listed fields must be equal; optional `stateLacks` |
| `"learn": {state, now}` | `takeLearn(state, now)` | `learn`; `save`; optional `stateLacks` |
| `"append": {reason, learned}` | `appendLearned(reason, learned)` | `equals`, or `endsWith` and `length` (in code points) |
| `"stats": [records]` | `stats(records)` | the listed fields, each equal |

- `node evolve/run.mjs` runs the cases against the reference core. That is the check an installation uses.
- In this repository, `node evolve/run.mjs --repo` also checks that Appendix A is the core's `LEARN_BRIEF`.

---

## Appendix A. The learning brief

The reason of a learning turn is `[Sibyl] learn`, a blank line, and this text. `{journal}` and `{learned}` are replaced by the two file paths, and `{stats}` by `formatStats` of the journal.

```text
The user asked Sibyl to learn from their recorded replies. Do this before you finish the turn, then end it as you normally would.

1. Read the statistics below, and the journal at {journal}. Each line is one prediction: the suggestions with their confidences, a short excerpt of what came before, and what the user actually replied.
2. Look for what would have made the predictions better: how this user phrases messages, what they tend to say after which kind of turn, which suggestions they never pick, what they add after picking one, and how your stated confidences compare with how often they were picked.
3. Rewrite {learned} with what you found: at most 1500 characters of plain bullet points, written as advice to yourself for predicting this user. Keep what the records still support from the current notes, drop what they contradict, and quote the user only in short examples.
4. Tell the user in a few lines what you changed.

Statistics:
{stats}
```
