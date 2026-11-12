// Runs conformance/cases.jsonl against the reference core (SPEC.md §10).
//   node conformance/run.mjs          the cases only: what an installation checks
//   node conformance/run.mjs --repo   also checks, in this repository, that the default PREDICT.md is the
//                                     same in the core, in ./PREDICT.md and in SPEC.md Appendix A. An installed
//                                     copy must not run this: its PREDICT.md is the user's own and may differ.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_PREDICT, decide, delivered, parsePredict } from '../reference/sibyl_core.mjs';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8').replace(/\r\n?/g, '\n');
const cases = read('conformance/cases.jsonl').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const failures = [];
const fail = (id, what) => failures.push(`${id}: ${what}`);
const show = (v) => JSON.stringify(v);

function checkDecide(c) {
  const got = decide(c.decide);
  const want = c.expect;
  if (got.decision !== want.decision) fail(c.id, `decision ${show(got.decision)}, want ${show(want.decision)}`);
  if ('reason' in want && got.reason !== want.reason) fail(c.id, `reason ${show(got.reason)}, want ${show(want.reason)}`);
  if (want.reasonStartsWith && !(got.reason ?? '').startsWith(want.reasonStartsWith)) {
    fail(c.id, `reason ${show(got.reason?.slice(0, 120))} does not start with ${show(want.reasonStartsWith)}`);
  }
  for (const part of want.reasonIncludes ?? []) {
    if (!(got.reason ?? '').includes(part)) fail(c.id, `reason does not include ${show(part)}`);
  }
  if (want.decision === 'allow' && got.reason !== undefined) fail(c.id, 'an allow carries no reason');
  if (got.save !== want.save) fail(c.id, `save ${show(got.save)}, want ${show(want.save)}`);
  if (want.state === null) {
    if (got.state !== null) fail(c.id, `state ${show(got.state)}, want null`);
  } else {
    for (const [k, v] of Object.entries(want.state)) {
      if (!isDeepStrictEqual(got.state?.[k], v)) fail(c.id, `state.${k} ${show(got.state?.[k])}, want ${show(v)}`);
    }
  }
  for (const k of want.stateLacks ?? []) if (got.state && k in got.state) fail(c.id, `state.${k} should be absent`);
  if (got.pending !== want.pending) fail(c.id, `pending ${show(got.pending)}, want ${show(want.pending)}`);
}

function checkParse(c) {
  const got = parsePredict(c.parse);
  const want = c.expect;
  if (!isDeepStrictEqual(got.config, want.config)) fail(c.id, `config ${show(got.config)}, want ${show(want.config)}`);
  if (got.notes.length !== want.notes) fail(c.id, `${got.notes.length} note(s), want ${want.notes}: ${show(got.notes)}`);
  if ('body' in want && got.body !== want.body) fail(c.id, `body ${show(got.body)}, want ${show(want.body)}`);
  if (want.bodyStartsWith && !got.body.startsWith(want.bodyStartsWith)) fail(c.id, `body does not start with ${show(want.bodyStartsWith)}`);
}

const ids = new Set();
for (const c of cases) {
  if (ids.has(c.id)) fail(c.id, 'duplicate id');
  ids.add(c.id);
  try {
    if ('decide' in c) checkDecide(c);
    else if ('parse' in c) checkParse(c);
    else if ('delivered' in c) {
      if (delivered(c.delivered) !== c.expect) fail(c.id, `delivered ${!c.expect}, want ${c.expect}`);
    } else fail(c.id, 'unknown kind of case');
  } catch (e) {
    fail(c.id, `threw ${e.message}`);
  }
}

// In the repository, the default template is written down three times; they must not drift apart.
const repo = process.argv.includes('--repo');
const docs = [];
if (repo) {
  if (read('PREDICT.md') !== DEFAULT_PREDICT) docs.push('PREDICT.md differs from the core\'s DEFAULT_PREDICT');
  const appendix = read('SPEC.md').split(/^## Appendix A\b.*$/m)[1]?.match(/```markdown\n([\s\S]*?)```/)?.[1];
  if (appendix !== DEFAULT_PREDICT) docs.push('SPEC.md Appendix A differs from the core\'s DEFAULT_PREDICT');
}

for (const f of failures) console.log('FAIL ' + f);
for (const d of docs) console.log('FAIL ' + d);
const failed = new Set(failures.map((f) => f.split(':')[0])).size;
console.log(`cases: ${cases.length - failed}/${cases.length} pass`
  + (repo ? `; default template: ${docs.length ? 'differs' : 'consistent'}` : ''));
console.log(failed || docs.length ? 'SIBYL CONFORMANCE: FAIL' : 'SIBYL CONFORMANCE: PASS');
process.exitCode = failed || docs.length ? 1 : 0;
