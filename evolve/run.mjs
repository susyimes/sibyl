// Runs evolve/cases.jsonl against the evolution module's reference core (evolve/SPEC.md §9).
//   node evolve/run.mjs          the cases only: what an installation checks
//   node evolve/run.mjs --repo   also checks, in this repository, that the learning brief in the core
//                                is the one printed in evolve/SPEC.md Appendix A
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  LEARN_BRIEF, appendLearned, classifyReply, parseEvolveSettings, parseSuggestions, recordReply, rememberPrediction, stats, takeLearn,
} from './learn_core.mjs';

const here = new URL('./', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, here)), 'utf8').replace(/\r\n?/g, '\n');
const cases = read('cases.jsonl').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const failures = [];
const fail = (id, what) => failures.push(`${id}: ${what}`);
const show = (v) => JSON.stringify(v);
const same = (id, what, got, want) => { if (!isDeepStrictEqual(got, want)) fail(id, `${what} ${show(got)}, want ${show(want)}`); };
const subset = (id, what, got, want) => {
  for (const [k, v] of Object.entries(want)) same(id, `${what}.${k}`, got?.[k], v);
};

const kinds = {
  settings(c) {
    const got = parseEvolveSettings(c.settings);
    same(c.id, 'settings', got.settings, c.expect.settings);
    same(c.id, 'notes', got.notes.length, c.expect.notes);
  },
  suggestions(c) {
    same(c.id, 'parse', parseSuggestions(c.suggestions), c.expect);
  },
  classify(c) {
    same(c.id, 'reply', classifyReply(c.classify.prompt, c.classify.suggestions), c.expect);
  },
  remember(c) {
    const got = rememberPrediction(c.remember);
    if (c.expect.last === null) {
      if (got.state && 'last' in got.state) fail(c.id, `state.last should be absent, got ${show(got.state.last)}`);
    } else {
      same(c.id, 'state.last', got.state?.last, c.expect.last);
    }
    if ('save' in c.expect) same(c.id, 'save', got.save, c.expect.save);
    if ('answer' in c.expect) {
      if (c.expect.answer === null) { if (got.state && 'answer' in got.state) fail(c.id, 'state.answer should be absent'); }
      else same(c.id, 'state.answer', got.state?.answer, c.expect.answer);
    }
  },
  record(c) {
    const got = recordReply(c.record);
    same(c.id, 'save', got.save, c.expect.save);
    if (c.expect.record === null) same(c.id, 'record', got.record, null);
    else subset(c.id, 'record', got.record, c.expect.record);
    for (const k of c.expect.stateLacks ?? []) if (got.state && k in got.state) fail(c.id, `state.${k} should be absent`);
  },
  learn(c) {
    const got = takeLearn(c.learn.state, c.learn.now);
    same(c.id, 'learn', got.learn, c.expect.learn);
    same(c.id, 'save', got.save, c.expect.save);
    for (const k of c.expect.stateLacks ?? []) if (got.state && k in got.state) fail(c.id, `state.${k} should be absent`);
  },
  append(c) {
    const got = appendLearned(c.append.reason, c.append.learned);
    if ('equals' in c.expect) same(c.id, 'reason', got, c.expect.equals);
    if ('endsWith' in c.expect && !got.endsWith(c.expect.endsWith)) fail(c.id, `reason does not end with ${show(c.expect.endsWith)}`);
    if ('length' in c.expect) same(c.id, 'length', [...got].length, c.expect.length);
  },
  stats(c) {
    subset(c.id, 'stats', stats(c.stats), c.expect);
  },
};

const ids = new Set();
for (const c of cases) {
  if (ids.has(c.id)) fail(c.id, 'duplicate id');
  ids.add(c.id);
  const kind = Object.keys(kinds).find((k) => k in c);
  try {
    if (kind) kinds[kind](c);
    else fail(c.id, 'unknown kind of case');
  } catch (e) {
    fail(c.id, `threw ${e.message}`);
  }
}

const repo = process.argv.includes('--repo');
const docs = [];
if (repo) {
  const appendix = read('SPEC.md').split(/^## Appendix A\b.*$/m)[1]?.match(/```text\n([\s\S]*?)```/)?.[1];
  if (appendix !== LEARN_BRIEF) docs.push('evolve/SPEC.md Appendix A differs from the core\'s LEARN_BRIEF');
}

for (const f of failures) console.log('FAIL ' + f);
for (const d of docs) console.log('FAIL ' + d);
const failed = new Set(failures.map((f) => f.split(':')[0])).size;
console.log(`cases: ${cases.length - failed}/${cases.length} pass` + (repo ? `; learning brief: ${docs.length ? 'differs' : 'consistent'}` : ''));
console.log(failed || docs.length ? 'SIBYL EVOLVE CONFORMANCE: FAIL' : 'SIBYL EVOLVE CONFORMANCE: PASS');
process.exitCode = failed || docs.length ? 1 : 0;
