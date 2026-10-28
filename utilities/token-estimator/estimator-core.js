/* Estimate tokenable text in network history without retaining source text. */
(() => {
  'use strict';

  // Text-only approximation, not OpenAI's private tokenizer. Unlike earlier
  // revisions, this processes every character of every selected text field.
  const CHUNKS = /[A-Za-z]+|[0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|\s+|[^A-Za-z0-9\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
  const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const NEWLINE = /\n/g;

  function estimateText(text) {
    if (typeof text !== 'string' || !text.length) return 0;
    let total = 0;
    CHUNKS.lastIndex = 0;
    let match;
    while ((match = CHUNKS.exec(text)) !== null) {
      const s = match[0];
      if (/^[A-Za-z]/.test(s)) total += Math.max(1, Math.ceil(s.length / 4.7));
      else if (/^[0-9]/.test(s)) total += Math.ceil(s.length / 3);
      else if (/^\s/u.test(s)) total += Math.floor((s.match(NEWLINE) || []).length / 2);
      else if (CJK.test(s)) total += Math.ceil([...s].length * 1.15);
      else total += Math.ceil([...s].length / 1.8);
    }
    return total;
  }

  // Network records commonly contain both a canonical content.parts array and
  // content.text/content.content renderings of the *same* words. Prefer the
  // structured parts when present; never sum alternate whole-message renderings.
  // Preserve repeated parts because distinct occurrences are actual text.
  // Parser is shared with Enhanced Copy; keep token-only records here.
  const contentTexts=globalThis.GPTTweaksConversationContent?.contentTexts;
  if(!contentTexts)throw Error("Shared conversation content parser is missing");

  function summarizeMessage(message) {
    if (!message || typeof message.id !== 'string') return null;
    const role = message.author?.role;
    if (!['user', 'assistant', 'tool', 'system', 'developer'].includes(role)) return null;
    const tokens = contentTexts(message.content).reduce((sum, text) => sum + estimateText(text), 0);
    // One message per user submission and one per completed assistant reply.
    // Progress/commentary/summary messages are intermediate records, not
    // additional assistant replies, even if they are rendered in the chat.
    const channel = message.channel || message.metadata?.channel || null;
    const recipient = message.recipient || 'all';
    // Some role=user records are injected context, not actual chat turns.
    // Visibility metadata takes precedence over role and channel.
    const hidden = message.metadata?.is_visually_hidden_from_conversation === true ||
      message.metadata?.is_user_system_message === true ||
      ['user_editable_context', 'model_editable_context'].includes(message.content?.content_type);
    const dialogueMessage = !hidden && (role === 'user' ||
      (role === 'assistant' && recipient === 'all' && message.end_turn === true &&
       (channel === 'final' || !channel)));
    return [message.id, tokens, dialogueMessage ? 1 : 0];
  }

  function summarizePage(messages) {
    if (!Array.isArray(messages)) throw new Error('Unsupported conversation response: missing messages');
    const out = [], seen = new Set();
    for (const message of messages) {
      const entry = summarizeMessage(message);
      if (entry && !seen.has(entry[0])) { seen.add(entry[0]); out.push(entry); }
    }
    return out;
  }

  function uniqueEntries(entries) {
    const result = [], seen = new Set();
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || seen.has(entry[0])) continue;
      seen.add(entry[0]); result.push(entry);
    }
    return result;
  }

  function mergeOlder(older, newer) { return uniqueEntries([...older, ...newer]); }

  function reconcilePage(cached, pageEntries, newerPages) {
    const positions = new Map(cached.map((e, i) => [e[0], i]));
    const first = pageEntries.findIndex(e => positions.has(e[0]));
    if (first < 0) return null;
    return uniqueEntries([
      ...cached.slice(0, positions.get(pageEntries[first][0])),
      ...pageEntries.slice(first),
      ...newerPages
    ]);
  }

  function metrics(entries) {
    let tokens = 0, messages = 0;
    for (const e of entries) {
      tokens += Number(e[1]) || 0;
      messages += e[2] ? 1 : 0;
    }
    return {tokens, messages, records: entries.length};
  }

  globalThis.CTCore = Object.freeze({
    estimateText, contentTexts, summarizeMessage, summarizePage,
    uniqueEntries, mergeOlder, reconcilePage, metrics
  });
})();