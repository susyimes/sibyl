// Sibyl reference core: an executable reading of SPEC.md §3 (PREDICT.md), §5 (the turn-end decision) and
// §6 (detecting delivered predictions). Pure functions only: no files, no network, nothing tool-specific.
// An integration maps its environment's turn-end event to decide()'s input, saves the state it returns,
// deletes a claimed or discarded pending request, and then lets the turn end or keeps it open with the reason.
// Where this file and SPEC.md disagree, SPEC.md governs.

/** The built-in PREDICT.md (SPEC.md Appendix A). */
export const DEFAULT_PREDICT = `---
default_on: false
mode: suggest
max_auto_turns: 3
---
Before you finish this turn, predict the message the user is most likely to send next. Use everything you know: this conversation, the state of the work, and the user's habits from your instruction files and memory.

The first line above says whether you may act (\`may_act=yes\`) or must only suggest (\`may_act=no\`).

- If you may act, and the next message is clear and only continues the current work (for example running the tests, or fixing a problem you just found): write one line \`Sibyl: "<the message>"\`, then carry on as if the user had sent it.
- Otherwise, end the turn with the user's likely next messages: a line that starts with \`Sibyl:\` and a short heading in the user's language, then one to three numbered lines, likeliest first, each written as the user would type it, in their language and voice. The user may answer with just the number.
- Only list, never act on, a message that would push, publish, deploy, delete, spend money, touch credentials, or choose a direction for the user.
- Your prediction is a guess, not the user's consent: approvals and permissions apply as usual.
- If you truly cannot tell what comes next, say so in one line after \`Sibyl:\` instead of inventing suggestions.
`;

const DEFAULTS = Object.freeze({ default_on: false, mode: 'suggest', max_auto_turns: 3 });
/** A pending /predict request older than this is discarded without being applied (SPEC §7). */
export const PENDING_TTL_MS = 120_000;
/** A Sibyl line that does not open with a quote mark: suggestions, or "cannot tell" (SPEC §6). */
const DELIVERED_RE = /^\s*\**Sibyl\**\s*[:：]\s*(?=[^\s"“「『])/im;

function split(text) {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!/^---[ \t]*\n/.test(t)) return { front: null, body: t };
  const rest = t.slice(t.indexOf('\n') + 1);
  const close = /^---[ \t]*$/m.exec(rest);
  if (!close) return { front: undefined, body: '' };
  return { front: rest.slice(0, close.index), body: rest.slice(close.index + close[0].length) };
}

const DEFAULT_BODY = split(DEFAULT_PREDICT).body.trim();

function parseValue(key, v) {
  if (key === 'default_on') return v === 'true' ? true : v === 'false' ? false : undefined;
  if (key === 'mode') return v === 'suggest' || v === 'act' ? v : undefined;
  if (key === 'max_auto_turns') return /^\d+$/.test(v) ? Number(v) : undefined;
  return undefined;
}

/**
 * Reads a PREDICT.md (SPEC §3). `text` null means no file was found: the built-in default applies.
 * Returns the settings, the body to hand to the agent, and one note per problem found.
 */
export function parsePredict(text) {
  const config = { ...DEFAULTS };
  const notes = [];
  if (text === null || text === undefined) return { config, body: DEFAULT_BODY, notes };
  const { front, body } = split(String(text));
  if (front === undefined) {
    notes.push('PREDICT.md: the front matter is not closed with "---"; using the defaults.');
    return { config, body: DEFAULT_BODY, notes };
  }
  for (const raw of (front ?? '').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    if (!Object.hasOwn(DEFAULTS, key)) continue;
    const value = line.slice(colon + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    const parsed = parseValue(key, value);
    if (parsed === undefined) notes.push(`PREDICT.md: invalid ${key} "${value}"; using ${JSON.stringify(DEFAULTS[key])}.`);
    else config[key] = parsed;
  }
  return { config, body: body.trim() || DEFAULT_BODY, notes };
}

/** Whether the agent's final message already holds the prediction (SPEC §6). */
export function delivered(text) {
  return typeof text === 'string' && DELIVERED_RE.test(text);
}

/**
 * The turn-end decision (SPEC §5.2).
 * input: { event: { continuing, finalText }, state, predict, pending, toolCap, now }
 * returns: { decision: 'allow' | 'keep_open', reason?, save, state, pending: 'none' | 'claimed' | 'discarded' }
 * With save false, `state` is the input state untouched and the integration writes nothing (off means off).
 */
export function decide(input) {
  const { event = {}, predict = null, pending = null, toolCap = null, now } = input;
  const { config, body, notes } = parsePredict(predict);
  const state = input.state ? { ...input.state } : { on: config.default_on, count: 0 };
  if (!Number.isInteger(state.count) || state.count < 0) state.count = 0;
  const saved = (decision, pendingOut, reason) => {
    state.updatedAt = now;
    return reason === undefined ? { decision, save: true, state, pending: pendingOut } : { decision, reason, save: true, state, pending: pendingOut };
  };

  let pendingOut = 'none';
  if (pending) {
    const fresh = now - pending.at < PENDING_TTL_MS;
    if (fresh && (pending.action === 'on' || pending.action === 'off')) {
      state.on = pending.action === 'on';
      if (state.on && (pending.mode === 'suggest' || pending.mode === 'act')) state.mode = pending.mode;
      else if (state.on) delete state.mode;
      state.count = 0;
      return saved('allow', 'claimed');            // the command's own turn is not predicted
    }
    pendingOut = 'discarded';
  }

  if (!state.on) return { decision: 'allow', save: false, state: input.state ?? null, pending: pendingOut };
  if (!event.continuing) state.count = 0;
  if (delivered(event.finalText)) return saved('allow', pendingOut);

  const mode = state.mode === 'suggest' || state.mode === 'act' ? state.mode : config.mode;
  let budget = mode === 'suggest' ? 1 : config.max_auto_turns + 1;
  if (Number.isInteger(toolCap) && toolCap >= 0) budget = Math.min(budget, toolCap);
  if (state.count >= budget) return saved('allow', pendingOut);

  state.count += 1;
  const mayAct = mode === 'act' && state.count < budget;
  const reason = [`[Sibyl] mode=${mode} may_act=${mayAct ? 'yes' : 'no'}`, ...notes].join('\n') + '\n\n' + body;
  return saved('keep_open', pendingOut, reason);
}
