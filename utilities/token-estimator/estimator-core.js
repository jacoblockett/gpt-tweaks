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
  const NON_TEXT_TYPES = new Set([
    'image', 'image_url', 'image_asset_pointer', 'audio', 'audio_asset_pointer',
    'audio_uncond', 'input_audio', 'video', 'video_frame', 'file',
    'file_asset_pointer', 'spatial', 'vector3', 'pose3', 'rotation3', 'joints'
  ]);
  const TEXT_FIELDS = ['text', 'content', 'transcript', 'transcription',
    'code', 'output', 'result', 'markdown', 'caption', 'summary'];

  function partTexts(part, depth = 0) {
    if (typeof part === 'string') return part ? [part] : [];
    if (!part || typeof part !== 'object' || depth > 6 || Array.isArray(part)) return [];
    const type = part.content_type || part.type;
    if (NON_TEXT_TYPES.has(type)) return [];
    // Pick one representation of a single text-bearing part, not text+content.
    for (const key of TEXT_FIELDS) {
      const value = part[key];
      if (typeof value === 'string' && value) return [value];
      if (Array.isArray(value)) {
        const items = value.flatMap(item => partTexts(item, depth + 1));
        if (items.length) return items;
      }
      if (value && typeof value === 'object') {
        const items = partTexts(value, depth + 1);
        if (items.length) return items;
      }
    }
    for (const name of ['parts', 'blocks', 'segments']) {
      if (Array.isArray(part[name])) return part[name].flatMap(p => partTexts(p, depth + 1));
    }
    return [];
  }

  function contentTexts(content) {
    // The live generation stream can include hidden user-context messages whose
    // text is not represented by `parts` or `text`. Estimate their distinct
    // prompt fields without counting transport metadata or object wrappers.
    if (content && typeof content === 'object' && content.content_type === 'user_editable_context') {
      return ['user_profile', 'user_instructions']
        .map(key => content[key]).filter(value => typeof value === 'string' && value.length);
    }
    if (content && typeof content === 'object' && content.content_type === 'model_editable_context') {
      return ['model_set_context', 'repo_summary']
        .map(key => content[key]).filter(value => typeof value === 'string' && value.length);
    }
    if (typeof content === 'string') return content ? [content] : [];
    if (!content || typeof content !== 'object') return [];
    if (Array.isArray(content)) return content.flatMap(part => partTexts(part));
    const text = [];
    if (Array.isArray(content.parts)) {
      for (const part of content.parts) text.push(...partTexts(part));
    }
    if (!text.length) {
      const fallback = partTexts(content);
      text.push(...fallback);
    }
    // Some responses supply reasoning summaries separately from content.parts.
    // They are textual network content, but aliases within a thought are not
    // separate tokenable text. Also skip any whole-message duplicate.
    if (Array.isArray(content.thoughts)) {
      for (const thought of content.thoughts) {
        const values = typeof thought === 'string' ? [thought] : partTexts(thought);
        for (const value of values) {
          if (value && !text.includes(value)) text.push(value);
        }
      }
    }
    return text;
  }

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