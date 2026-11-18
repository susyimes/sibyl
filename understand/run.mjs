// Run the portable cases and the optional Node store's integration checks in a disposable directory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finishOffer, parseMenu, routeInput } from './understand_core.mjs';
import { UnderstandingStore } from './file_store.mjs';

const cases = fs.readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const menu = 'Sibyl 理解\n\n来自前文的低模港口\n\ns1. 拖轮展示\n\ns2. 清晨归港并留下尾流\n\ns3. 操控渡船';
const event = { session: 'a', project: 'port', messageId: 'open', prompt: '/sibyl 做个船', now: 1000 };
const draft = routeInput(event).state;
const ready = finishOffer(draft, 'open', menu).state;
const errors = [];
for (const c of cases) {
  try {
    if ('parse' in c) { assert.deepEqual(parseMenu(c.parse), c.expect); continue; }
    const prompt = c.start ?? c.ready;
    const result = routeInput({ ...event, messageId: 'reply', prompt, state: 'ready' in c ? ready : null, journal: c.journal });
    assert.equal(result.action, c.action);
    assert.equal(result.state?.phase, c.phase);
    if (c.incl) assert.ok(result.reason.includes(c.incl));
    if (c.noRecord) assert.equal(result.record, null);
    if (c.label) {
      assert.deepEqual(result.record.selection, { label: c.label, reply: prompt, extra: c.extra });
      assert.equal(result.record.layer, 'understand');
      assert.equal(result.record.effectiveRequest, result.reason);
      assert.ok(result.reason.includes(ready.menu.choices.find(choice => choice.label === c.label).text));
      assert.ok(result.reason.includes(ready.menu.context));
      if (c.extra) assert.ok(result.reason.endsWith(c.extra));
    }
  } catch (error) { errors.push(`${c.id}: ${error.message}`); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sibyl-understand-'));
try {
  const root = path.join(dir, 'understand');
  const store = new UnderstandingStore(root);
  const records = () => fs.readFileSync(store.journal, 'utf8').trim().split('\n').map(JSON.parse);
  const put = (session, messageId, prompt, journal = true) => store.submit({ ...event, session, messageId, prompt, journal });
  const deliver = (session, roundId, finalText = menu) => store.finish({ session, roundId, finalText });
  assert.equal((await put('a', 'ordinary', 'hello')).action, 'pass');
  assert.equal(fs.existsSync(root), false);
  await put('a', 'open', event.prompt);
  assert.equal((await deliver('a', 'wrong')).action, 'ignore');
  assert.equal((await deliver('a', 'open', 'incomplete')).action, 'invalid');
  assert.equal((await put('a', 'early', 's2')).action, 'notice');
  assert.equal((await deliver('a', 'open', 'Sibyl 理解\n\n? 哪张图？')).action, 'question');
  assert.equal((await put('a', 'more', '刚上传的图')).state.refinements[0], '刚上传的图');
  assert.equal((await deliver('a', 'more')).action, 'ready');
  assert.equal((await put('a', 'refresh', '换一组，低模')).action, 'offer');
  assert.equal((await deliver('a', 'more')).action, 'ignore');
  await deliver('a', 'refresh');
  assert.equal((await put('b', 'a-pick', 's2')).action, 'pass');
  assert.ok(!fs.existsSync(store.journal));
  const inputs = await Promise.all([put('a', 'chosen', 's2，黄昏'), put('a', 'chosen', 's2，黄昏')]);
  assert.deepEqual(inputs.map(r => r.action).sort(), ['duplicate', 'select']);
  assert.deepEqual(records()[0].refinements, ['刚上传的图', '低模']);
  assert.equal(records()[0].roundId, 'refresh');
  assert.equal(store.current('a'), null);
  assert.equal((await new UnderstandingStore(root).submit({ ...event, messageId: 'chosen', prompt: 's2，黄昏' })).action, 'duplicate');
  await put('a', 'again', event.prompt, false);
  await deliver('a', 'again');
  assert.equal((await put('a', 'private', 's2', false)).record, null);
  assert.ok(!fs.readFileSync(store.sessionFile('a'), 'utf8').includes('清晨'));
  assert.equal(records().length, 1);
  await Promise.all(['b', 'c'].map(async session => {
    await put(session, 'open', event.prompt);
    await deliver(session, 'open');
    await put(session, 'chosen', 's1');
  }));
  assert.equal(records().length, 3);
  assert.equal(new Set(records().map(r => r.session)).size, 3);
  const sessionFile = store.sessionFile('a');
  const checkpoint = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  checkpoint.outbox = records()[0]; // A crash after the journal commit, before clearing the outbox.
  fs.writeFileSync(sessionFile, JSON.stringify(checkpoint));
  await put('a', 'chosen', 's2，黄昏');
  assert.equal(records().length, 3);
  assert.equal(JSON.parse(fs.readFileSync(sessionFile, 'utf8')).outbox, undefined);
  assert.equal(path.dirname(store.sessionFile('../escape')), path.join(root, 'sessions'));
  assert.throws(() => routeInput({ ...event, session: 'b', state: ready }));
  const longPrompt = '请用 Three.js 制作一艘低多边形的船。' + '在手机竖屏里展示完整船体和甲板细节。'.repeat(10) + '\n\n验收时请切换到已有的拖动镜头，从三个角度观察并确认船体完整。';
  await put('long-copy', 'start', event.prompt);
  await deliver('long-copy', 'start', `Sibyl 理解\n\ns1. 静态资产\n\ns2. ${longPrompt}\n\ns3. 港湾场景`);
  const longPick = await put('long-copy', 'choose', 's2，只给我提示词');
  assert.equal(longPick.record.choices[1].text, longPrompt);
  assert.ok(longPick.reason.includes(longPrompt));
  assert.equal(records().at(-1).choices[1].text, longPrompt);
} catch (error) { errors.push(`store: ${error.stack}`); }
finally { fs.rmSync(dir, { recursive: true, force: true }); }

for (const error of errors) console.error('FAIL ' + error);
console.log(`SIBYL UNDERSTAND CONFORMANCE: ${errors.length ? 'FAIL' : 'PASS'} (${cases.length} portable cases + store integration)`);
process.exitCode = errors.length ? 1 : 0;
