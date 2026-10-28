/* Shared structured conversation text extraction. Keep canonical Markdown
 * as supplied in text parts; never count duplicate alternate renderings.
 * No conversation contents are cached or sent to the extension worker. */
(() => {
  "use strict";
  if(globalThis.GPTTweaksConversationContent)return;
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

  function contentTexts(content, includeThoughts = true) {
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
    if (includeThoughts && Array.isArray(content.thoughts)) {
      for (const thought of content.thoughts) {
        const values = typeof thought === 'string' ? [thought] : partTexts(thought);
        for (const value of values) {
          if (value && !text.includes(value)) text.push(value);
        }
      }
    }
    return text;
  }


  globalThis.GPTTweaksConversationContent=Object.freeze({contentTexts});
})();
