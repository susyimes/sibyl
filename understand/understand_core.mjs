// The understanding module's portable decision logic. All I/O belongs to its host.
export const OFFER_BRIEF = `The user explicitly invoked Sibyl to expand their request. Use this conversation, the current project and the user's still-applicable constraints. Stay in the current agent. During this turn only inspect what is needed to understand the request. Wait for the user to choose before working on any candidate, even in act mode.

Before drafting, recover the deliverable and binding constraints from preceding user messages and the project's applicable instructions. If a directory inspection shows an AGENTS.md or an equivalent project brief whose contents you have not seen, read it now. Apply each explicit scope limit to all three options. For an asset-only request, for example, vary the asset design within scope. Attribute existing conventions accurately in every option. When a project says to reuse its scale, origin, API or style but does not supply the exact values, carry that instruction forward as written. Do not invent measurements, axes, identifiers or versions and attribute them to the project. Put genuinely open design decisions inside the choices as proposals.

Your deliverable is three improved versions of the user's input. Write each in the user's voice as a standalone prompt that they can copy verbatim into a fresh chat. Carry the original goal, tool, deliverable and essential context into EACH version. Elaborate the details that would help an implementer succeed: what the finished work should look like or do, how it fits the existing project, and how the user can tell it is finished. For a terse creative or engineering request in Chinese, normally develop about 150–3000 Chinese characters per option (roughly 100–1800 words in English). Use one or two substantive paragraphs per option. This is a writing target, not a quota; keep simple, tightly specified requests concise. Put the most faithful rewrite first. The other two should improve the same request with a meaningful difference in emphasis or interpretation. Spend the extra text clarifying the user's commission, not multiplying features or explaining your reasoning.

Write one menu in the user's language. Its first line is exactly “Sibyl 理解”. You may add a short shared-context paragraph identifying its source. Start each complete prompt with the literal label s1. s2. or s3. respectively. A title is optional. Proposed details belong in the choices. Omit confidence scores, a footer, code fences and a second prediction menu. If all three choices depend on a missing referent or a hard contradiction, use the same heading and a single question starting with “?” instead.

On the user's next message, a selection such as “s2” refers to that exact displayed option and the shared constraints. Apply any accompanying revision with priority. Carry out that commission in the host's current mode. A request for a prompt only or a plan only constrains the deliverable. While a menu is pending, “换一组” or “regenerate” asks for a fresh menu for the original request with the added constraints. “取消” or “cancel” ends this interaction. A bare number and ordinary messages keep their usual meaning.`;

const COMMAND = /^\/sibyl(?=\s|$)/i;
const HEADING = /^(?:#{1,6}\s+)?(?:\*\*)?Sibyl (?:理解|Understand)(?:\*\*)?\s*$/i;
const REFRESH = /^(?:换一组|再来一组|regenerate)(?=$|[\s,，:：。.!！])/iu;
const LABEL = /^s(\d+)(?![\da-z_])[\s,，、:：.。;；!！-]*/i;
const CLEAN_SEPARATOR = /^[\s,，、:：.。!！-]+/u;
const MENU_CONTROL = /^(?:pick one|choose one|请选一项|请选择一项)[.!。！]?$/iu;

export function isUnderstandCommand(prompt) {
  return typeof prompt === 'string' && COMMAND.test(prompt.trimStart());
}

// Accept visual bolding and soft wraps, while storing the text the person saw.
export function parseMenu(finalText) {
  if (typeof finalText !== 'string') return null;
  const lines = finalText.trim().replace(/\r\n?/g, '\n').split('\n');
  if (!HEADING.test(lines.shift()?.trim()) || lines.some(line => /^\s*(?:```|~~~)/.test(line))) return null;
  const body = lines.join('\n').trim();
  if (/^[?？]\s*\S[^\n]*$/u.test(body)) return { question: body.slice(1).trim() };
  const context = [];
  const choices = [];
  let gap = false;
  for (let line of lines) {
    line = line.trim();
    if (!line) { gap = true; continue; }
    if (HEADING.test(line) || /^\**Sibyl\**\s*[:：]/i.test(line)) return null;
    line = line.replace(/^[-*•]\s+(?=\**s\d)/i, '');
    if (/^\*\*s\d/i.test(line)) line = line.slice(2).replace('**', '');
    const entry = /^s(\d+)[.．、)）:：]\s*(.*)$/i.exec(line);
    if (entry) {
      if (entry[1] !== String(choices.length + 1) || choices.length === 3) return null;
      choices.push({ label: `s${entry[1]}`, text: entry[2] });
    } else if (choices.length) {
      if (gap && MENU_CONTROL.test(line)) return null;
      const choice = choices[choices.length - 1];
      choice.text += (choice.text ? (gap ? '\n\n' : '\n') : '') + line;
    } else {
      context.push(line);
    }
    gap = false;
  }
  if (choices.length !== 3 || choices.some(c => !c.text) || new Set(choices.map(c => c.text)).size !== 3) return null;
  return { context: context.join('\n'), choices };
}

function draft(request, refinements, session, messageId) {
  return { layer: 'understand', session, roundId: messageId, phase: 'draft', request, refinements };
}

export function offerReason(state) {
  const parts = [OFFER_BRIEF, `User request:\n${state.request}`];
  if (state.refinements.length) parts.push(`User refinements, oldest first:\n${state.refinements.join('\n')}`);
  return parts.join('\n\n');
}

function offer(state) {
  return { action: 'offer', state, reason: offerReason(state) };
}

function selectedRequest(state, choice, addition) {
  const parts = [`Original user request:\n${state.request}`];
  if (state.refinements.length) parts.push(`User refinements:\n${state.refinements.join('\n')}`);
  if (state.menu.context) parts.push(`Shared context shown to the user:\n${state.menu.context}`);
  parts.push(`Selected ${choice.label}:\n${choice.text}`);
  if (addition) parts.push(`Latest user amendment (takes precedence):\n${addition}`);
  return parts.join('\n\n');
}

/** Route a real user message before either ordinary execution or prediction logging. */
export function routeInput({ state = null, prompt, session, messageId, project = null, now, journal = true }) {
  if (state && state.session !== session) throw new Error('Understanding state belongs to another session');
  const text = String(prompt ?? '').trim();
  if (isUnderstandCommand(text)) {
    const request = text.replace(COMMAND, '').trim();
    if (!request) return { action: 'notice', state: null, reason: '用 /sibyl 加上一句想做的事，例如 /sibyl 做个 Three.js 船。' };
    return offer(draft(request, [], session, messageId));
  }
  if (!state) return { action: 'pass', state: null };
  if (/^(?:取消|cancel)[。.!！]?$/iu.test(text)) return { action: 'notice', state: null, reason: 'Sibyl 理解已取消。' };
  const refresh = REFRESH.exec(text);
  if (refresh) {
    const extra = text.slice(refresh[0].length).replace(CLEAN_SEPARATOR, '').trim();
    return offer(draft(state.request, extra ? [...state.refinements, extra] : state.refinements, session, messageId));
  }
  const pick = LABEL.exec(text);
  if (pick) {
    const choice = state.phase === 'ready' && state.menu.choices.find(c => c.label === `s${pick[1]}`);
    if (!choice) return { action: 'notice', state, reason: '请选当前完整展示的一条，或回复「换一组」。' };
    const extra = text.slice(pick[0].length).trim();
    const effectiveRequest = selectedRequest(state, choice, extra);
    const record = journal ? {
      layer: 'understand', at: now, session, project, roundId: state.roundId, messageId,
      request: state.request, refinements: state.refinements, context: state.menu.context, choices: state.menu.choices,
      selection: { label: choice.label, reply: prompt, extra }, effectiveRequest,
    } : null;
    return { action: 'select', state: null, reason: effectiveRequest, record };
  }
  if (state.phase === 'question' && text && !/^(?:\/|\d)/.test(text)) {
    return offer(draft(state.request, [...state.refinements, text], session, messageId));
  }
  return { action: 'pass', state: null };
}

/** Call only for the delivered assistant text in the original offer turn. */
export function finishOffer(state, roundId, finalText) {
  if (!state || state.roundId !== roundId || state.phase !== 'draft') return { action: 'ignore', state };
  const menu = parseMenu(finalText);
  if (!menu) return { action: 'invalid', state };
  if (menu.question) return { action: 'question', state: { ...state, phase: 'question', question: menu.question } };
  return { action: 'ready', state: { ...state, phase: 'ready', menu } };
}
