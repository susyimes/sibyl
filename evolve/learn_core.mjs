// Sibyl evolution module, reference core: an executable reading of evolve/SPEC.md §4–§7.
// Pure functions only: no files, no network, nothing tool-specific, and no dependency on the base core.
// The integration calls these around the base decide(): it records what was predicted and what the user
// replied, applies the learned notes, and runs a learning turn when asked. Where this file and
// evolve/SPEC.md disagree, the specification governs.

/** The brief for a learning turn (evolve/SPEC.md Appendix A). {journal}, {learned} and {stats} are filled in. */
export const LEARN_BRIEF = `The user asked Sibyl to learn from their recorded replies. Do this before you finish the turn, then end it as you normally would.

1. Read the statistics below, and the journal at {journal}. Each line is one prediction: the suggestions with their confidences, a short excerpt of what came before, which agent made it, and what the user actually replied.
2. Look for what would have made the predictions better: how this user phrases messages, what they tend to say after which kind of turn, which suggestions they never pick, what they add after picking one, and how stated confidences compare with how often they were picked.
3. Rewrite {learned}. It is a model of this user that every agent on this machine reads before predicting, so write it for any agent, not only for yourself. Keep to these rules:
   - Start with one line, \`<!-- Sibyl LEARNED.md · v<n> · <date> · <records> records -->\`, counting the version up from the current file.
   - Copy calibration numbers exactly as the statistics give them; do not estimate your own. Where agents differ, give them per agent.
   - Give each pattern its evidence as (k/n). Leave out patterns that fewer than 3 records support, or that the records now contradict.
   - Write at most 1500 characters after the first line, quoting the user only in short examples. Include no credentials, keys or personal identifiers.
   - Do not repeat what the user wrote in PREDICT.md: those notes are theirs, and they already reach every prediction.

   These sections are a suggested shape, not a requirement; add, merge, rename or drop them as the records call for:
   ## Calibration
   ## How this user writes
   ## What usually comes next
   ## What not to suggest
   ## Per project
4. Tell the user in a few lines what you changed.

Statistics:
{stats}
`;

/** The line that introduces the learned notes in a prediction's reason (evolve/SPEC.md §6). */
export const LEARNED_HEADER = 'What Sibyl has learned about this user (LEARNED.md). Treat it as evidence, not as rules:';

const SETTINGS = Object.freeze({ journal: true, journal_max: 2000 });
/** A remembered prediction older than this is not matched against a reply (evolve/SPEC.md §4). */
export const LAST_TTL_MS = 24 * 3_600_000;
const LEARNED_MAX = 3000;
const REPLY_MAX = 2000;
const CONTEXT_MAX = 300;

const HEADING_RE = /^\s*Sibyl\s*[:：]\s*(?:$|(?=[^\s"“「『]))/i;
const LABEL_RE = /^\s*[-*•]?\s*s([1-9])\s*[.、)．:：]\s*(.*?)\s*$/i;
const CONFIDENCE_RE = /\s*[·•]\s*(\d*\.?\d+)\s*$/;
const COMMAND_RE = /^\s*\/predict(?:\s|$)/i;

const cut = (text, max) => {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('') : text;
};
const cutEnd = (text, max) => {
  const chars = [...text];
  return chars.length > max ? chars.slice(chars.length - max).join('') : text;
};

/** The module's two settings from a PREDICT.md text; anything else in the file is the base's business. */
export function parseEvolveSettings(text) {
  const settings = { ...SETTINGS };
  const notes = [];
  if (typeof text !== 'string') return { settings, notes };
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!/^---[ \t]*\n/.test(t)) return { settings, notes };
  const rest = t.slice(t.indexOf('\n') + 1);
  const close = /^---[ \t]*$/m.exec(rest);
  if (!close) return { settings, notes };
  for (const raw of rest.slice(0, close.index).split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (!line || line.startsWith('#') || colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (key === 'journal') {
      if (value === 'true' || value === 'false') settings.journal = value === 'true';
      else notes.push(`PREDICT.md: invalid journal "${value}"; using true.`);
    } else if (key === 'journal_max') {
      if (/^\d+$/.test(value) && Number(value) > 0) settings.journal_max = Number(value);
      else notes.push(`PREDICT.md: invalid journal_max "${value}"; using 2000.`);
    }
  }
  return { settings, notes };
}

/**
 * The suggestions in an agent message (SPEC.md §6): those after the last Sibyl heading, labelled s1–s9,
 * each with its confidence when one is given. null when the message has no Sibyl heading.
 */
export function parseSuggestions(text) {
  if (typeof text !== 'string') return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\*\*/g, ''));
  let start = -1;
  lines.forEach((line, i) => { if (HEADING_RE.test(line)) start = i; });
  if (start < 0) return null;
  const suggestions = [];
  for (const line of lines.slice(start + 1)) {
    const m = LABEL_RE.exec(line);
    if (!m) continue;
    const label = `s${m[1]}`;
    if (suggestions.some((s) => s.label === label)) continue;
    let body = m[2];
    let confidence = null;
    const c = CONFIDENCE_RE.exec(body);
    if (c && Number(c[1]) >= 0 && Number(c[1]) <= 1) {
      confidence = Number(c[1]);
      body = body.slice(0, c.index);
    }
    suggestions.push({ label, text: body.trim(), confidence });
  }
  return { suggestions, cannotTell: suggestions.length === 0 };
}

const norm = (s) => String(s).toLowerCase().replace(/[\s"'`“”‘’「」『』。，,.!！?？;；:：、()（）]+/g, '');

/** What kind of reply the user gave to a set of suggestions (evolve/SPEC.md §4). */
export function classifyReply(prompt, suggestions) {
  const p = String(prompt ?? '').trim();
  const m = /^s([1-9])(?![0-9a-z])\s*[,，、:：.。;；!！-]?\s*([\s\S]*)$/i.exec(p);
  if (m && suggestions.some((s) => s.label === `s${m[1]}`)) {
    const extra = m[2].trim();
    return extra ? { kind: 'pick_plus', label: `s${m[1]}`, extra } : { kind: 'pick', label: `s${m[1]}` };
  }
  const same = suggestions.find((s) => norm(s.text) && norm(s.text) === norm(p));
  if (same) return { kind: 'pick', label: same.label, typed: true };
  if (/^\d+(?!\d)/.test(p)) return { kind: 'own_option' };
  return { kind: 'other' };
}

/**
 * At a turn end, after the base decide() (evolve/SPEC.md §5).
 * - When the turn is kept open for a prediction, keep the end of the agent's answer as `answer`: where the
 *   prediction arrives as a message of its own, the answer is not in that message.
 * - When the agent has delivered suggestions, remember them as `last`, with the answer as context, so that
 *   the user's reply can be matched against them.
 * Leaves an unsaved (off) result untouched.
 */
export function rememberPrediction({ result, finalText, now }) {
  if (!result || !result.save) return result;
  if (result.decision === 'keep_open') {
    const answer = cutEnd(String(finalText ?? '').trim(), CONTEXT_MAX);
    if (!answer) return result;
    return { ...result, state: { ...result.state, answer } };
  }
  if (result.decision !== 'allow') return result;
  const parsed = parseSuggestions(finalText);
  if (!parsed) return result;
  const state = { ...result.state };
  if (parsed.suggestions.length) {
    const lines = String(finalText).replace(/\r\n?/g, '\n').split('\n');
    const at = lines.findLastIndex((l) => HEADING_RE.test(l.replace(/\*\*/g, '')));
    const before = cutEnd(lines.slice(0, at).join('\n').trim(), CONTEXT_MAX);
    state.last = { at: now, context: before || state.answer || '', suggestions: parsed.suggestions };
  } else {
    delete state.last;                                   // "cannot tell": nothing to match a reply against
  }
  delete state.answer;
  return { ...result, state };
}

/** At the user's next message (evolve/SPEC.md §4): one journal record, or none. */
export function recordReply({ state, prompt, now, session = null, agent = null, project = null, learned = null, journal = true }) {
  const none = { record: null, save: false, state };
  if (!state || !state.last || !state.on) return none;   // off means off
  if (COMMAND_RE.test(String(prompt ?? ''))) return none;
  const next = { ...state, updatedAt: now };
  delete next.last;
  if (!journal || now - state.last.at > LAST_TTL_MS) return { record: null, save: true, state: next };
  const text = String(prompt ?? '');
  const record = {
    at: now,
    session,
    agent,
    project,
    predictedAt: state.last.at,
    context: state.last.context,
    suggestions: state.last.suggestions,
    reply: { ...classifyReply(text, state.last.suggestions), text: cut(text, REPLY_MAX) },
    learned,
  };
  return { record, save: true, state: next };
}

/** `/predict learn` for a known session: mark it, so that the next turn end runs the learning brief. */
export function requestLearn(state, now) {
  return { ...(state ?? { on: false, count: 0 }), learn: true, updatedAt: now };
}

/** At a turn end, before the base decide() (evolve/SPEC.md §7): whether this end is a learning turn. */
export function takeLearn(state, now) {
  if (!state || !state.learn) return { learn: false, save: false, state };
  const next = { ...state, updatedAt: now };
  delete next.learn;
  return { learn: true, save: true, state: next };
}

/** The reason for a learning turn. */
export function learnReason({ journal, learned, stats }) {
  return '[Sibyl] learn\n\n' + LEARN_BRIEF
    .replace('{journal}', journal)
    .replace('{learned}', learned)
    .replace('{stats}', stats);
}

/** A prediction's reason with the learned notes after it (evolve/SPEC.md §6). */
export function appendLearned(reason, learned) {
  const notes = typeof learned === 'string' ? learned.trim() : '';
  if (!notes) return reason;
  const kept = cut(notes, LEARNED_MAX);
  return `${reason}\n\n${LEARNED_HEADER}\n${kept}${kept.length < notes.length ? '\n[notes cut at 3000 characters]' : ''}`;
}

const hit = (r, label) => (r.reply.kind === 'pick' || r.reply.kind === 'pick_plus') && (!label || r.reply.label === label);

/** Statistics over journal records (evolve/SPEC.md §7). */
export function stats(records) {
  const usable = (records ?? []).filter((r) => r && Array.isArray(r.suggestions) && r.suggestions.length && r.reply);
  const count = (kind) => usable.filter((r) => r.reply.kind === kind).length;
  const bins = [0, 1, 2, 3, 4].map((i) => ({ from: i / 5, to: (i + 1) / 5, n: 0, stated: 0, picked: 0 }));
  let brierSum = 0;
  let brierN = 0;
  const byLearned = {};
  const byAgent = {};
  for (const r of usable) {
    for (const [group, key] of [[byLearned, r.learned ?? 'none'], [byAgent, r.agent ?? 'unknown']]) {
      group[key] ??= { records: 0, hits: 0 };
      group[key].records += 1;
      if (hit(r)) group[key].hits += 1;
    }
    for (const s of r.suggestions) {
      if (typeof s.confidence !== 'number') continue;
      const outcome = hit(r, s.label) ? 1 : 0;
      const bin = bins[Math.min(4, Math.floor(s.confidence * 5))];
      bin.n += 1;
      bin.stated += s.confidence;
      bin.picked += outcome;
      brierSum += (s.confidence - outcome) ** 2;
      brierN += 1;
    }
  }
  const n = usable.length;
  const ratio = (a, b) => (b ? Math.round((a / b) * 100) / 100 : null);
  return {
    records: n,
    pick: count('pick'),
    pickPlus: count('pick_plus'),
    ownOption: count('own_option'),
    other: count('other'),
    hitRate: ratio(count('pick') + count('pick_plus'), n),
    firstChoiceRate: ratio(usable.filter((r) => hit(r, 's1')).length, n),
    calibration: bins.filter((b) => b.n).map((b) => ({
      from: b.from, to: b.to, n: b.n, stated: ratio(b.stated, b.n), picked: ratio(b.picked, b.n),
    })),
    brier: ratio(brierSum, brierN),
    byLearned,
    byAgent,
  };
}

/** The statistics as a few lines for the user, and for the learning brief. */
export function formatStats(s) {
  if (!s.records) return 'Sibyl journal: no answered predictions yet.';
  const lines = [
    `Sibyl journal: ${s.records} answered predictions`,
    `picked ${s.pick}, picked with additions ${s.pickPlus}, the agent's own option ${s.ownOption}, something else ${s.other}`,
    `hit rate ${s.hitRate}, first-choice rate ${s.firstChoiceRate}`,
  ];
  if (s.calibration.length) {
    lines.push('calibration (stated confidence -> how often picked):');
    for (const b of s.calibration) lines.push(`  ${b.from.toFixed(1)}-${b.to.toFixed(1)}: ${b.n} suggestions, stated ${b.stated}, picked ${b.picked}`);
    lines.push(`Brier score ${s.brier} (lower is better)`);
  }
  for (const [label, group] of [['notes version', s.byLearned], ['agent', s.byAgent]]) {
    const entries = Object.entries(group);
    if (entries.length > 1) lines.push(`hit rate by ${label}: ` + entries.map(([k, v]) => `${k} ${v.hits}/${v.records}`).join(', '));
  }
  return lines.join('\n');
}
