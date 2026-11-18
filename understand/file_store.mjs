// Optional Node filesystem adapter. Pass the understanding data directory, never the prediction home.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { finishOffer, isUnderstandCommand, routeInput } from './understand_core.mjs';

function read(file, missing) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return missing; throw error; }
}

function replace(file, content) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}

function abandoned(lock) {
  const text = read(lock, null);
  if (text === null) return false;
  const pid = Number(text);
  if (!Number.isInteger(pid) || pid < 1) {
    const stat = fs.statSync(lock, { throwIfNoEntry: false });
    return Boolean(stat && Date.now() - stat.mtimeMs > 30_000);
  }
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}

// Serialize independent hook processes. Only a confirmed dead owner can be displaced.
async function withLock(file, fn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = file + '.lock';
  const deadline = Date.now() + 8_000;
  for (;;) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (abandoned(lock)) {
      const reap = lock + '.recover';
      let owner = false;
      try {
        fs.writeFileSync(reap, String(process.pid), { flag: 'wx', mode: 0o600 });
        owner = true;
        if (abandoned(lock)) fs.rmSync(lock, { force: true });
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
      finally { if (owner) fs.rmSync(reap, { force: true }); }
    }
    if (Date.now() >= deadline) throw new Error('Timed out waiting for understanding storage');
    await delay(15);
  }
  try { return await fn(); } finally { fs.rmSync(lock, { force: true }); }
}

export class UnderstandingStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.journal = path.join(this.directory, 'journal.jsonl');
  }

  sessionFile(session) {
    if (typeof session !== 'string' || !session.trim()) throw new Error('A session id is required');
    const plain = /^[a-z\d][a-z\d_-]{0,95}$/.test(session) && !/^(?:con|prn|aux|nul|com\d|lpt\d)$/.test(session);
    const key = plain ? session : '~' + createHash('sha256').update(session).digest('hex');
    return path.join(this.directory, 'sessions', `${key}.json`);
  }

  load(file, session) {
    const raw = read(file, null);
    if (raw === null) return { layer: 'understand', session, active: null, recent: [] };
    const data = JSON.parse(raw);
    if (data.layer !== 'understand' || data.session !== session || !Array.isArray(data.recent)) throw new Error('Invalid understanding session');
    return data;
  }

  current(session) { return this.load(this.sessionFile(session), session).active; }

  // A selection and its pending journal write first commit together in the session snapshot.
  // Complete an interrupted write before accepting another input, once per session/message pair.
  async flush(file, data) {
    if (!data.outbox) return;
    const record = data.outbox;
    await withLock(this.journal, () => {
      const raw = read(this.journal, '');
      const found = raw.split('\n').some(line => {
        if (!line.trim()) return false;
        const entry = JSON.parse(line);
        return entry.layer === 'understand' && entry.session === record.session && entry.messageId === record.messageId;
      });
      if (!found) replace(this.journal, raw + (raw && !raw.endsWith('\n') ? '\n' : '') + JSON.stringify(record) + '\n');
    });
    delete data.outbox;
    replace(file, JSON.stringify(data));
  }

  async submit(event) {
    const { session, messageId } = event;
    const file = this.sessionFile(session);
    const busy = fs.existsSync(file + '.lock');
    if (!busy && !isUnderstandCommand(event.prompt) && !fs.existsSync(file)) return { action: 'pass', state: null };
    const prior = this.load(file, session);
    if (!busy && !prior.active && !prior.outbox && !isUnderstandCommand(event.prompt) && !prior.recent.includes(messageId)) return { action: 'pass', state: null };
    if (typeof messageId !== 'string' || !messageId) throw new Error('A stable user message id is required');
    return withLock(file, async () => {
      const data = this.load(file, session);
      await this.flush(file, data);
      if (data.recent.includes(messageId)) return { action: 'duplicate', state: data.active };
      const result = routeInput({ now: Date.now(), ...event, state: data.active });
      if (result.action === 'pass' && !data.active) return result;
      data.active = result.state;
      if (result.action !== 'pass') data.recent.push(messageId);
      if (result.record) data.outbox = result.record;
      replace(file, JSON.stringify(data));
      await this.flush(file, data);
      return result;
    });
  }

  async finish({ session, roundId, finalText }) {
    const file = this.sessionFile(session);
    if (!fs.existsSync(file)) return { action: 'ignore', state: null };
    return withLock(file, () => {
      const data = this.load(file, session);
      const result = finishOffer(data.active, roundId, finalText);
      if (result.state !== data.active) { data.active = result.state; replace(file, JSON.stringify(data)); }
      return result;
    });
  }
}
