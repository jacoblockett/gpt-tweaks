/* Bridge running in the page's MAIN world. The browser receives the same
 * successful history response as ChatGPT; only numeric summaries cross to
 * the extension world. No credentials or conversation text are persisted. */
(() => {
  'use strict';
  if (window.__ctHistoryBridgeV1) return;
  window.__ctHistoryBridgeV1 = true;
  const core = window.CTCore;
  const nativeFetch = window.fetch.bind(window);
  const history = window.GPTTweaksConversationHistory;
  if (!history) throw Error('Shared conversation history transport is missing');
  let trackingEnabled = true;
  document.addEventListener('ct-v1-tracker-enabled', event => {
    trackingEnabled = event.detail === 'true';
  });
  // Bounded in-memory replay of history pages ChatGPT fetched itself.
  const nativePages = new Map();
  const historyPrefix = '/backend-api/conversations/';
  const validId = id => typeof id === 'string' && /^[a-f\d-]{36}$/i.test(id);

  function publish(type, info) {
    document.dispatchEvent(new CustomEvent('ct-v1-history', {
      detail: JSON.stringify({type, ...info})
    }));
  }
  function summarize(payload) {
    if (!Array.isArray(payload?.messages) || !payload.page_info)
      throw new Error('Unsupported conversation-history response');
    const userTimes=[];
    for(const message of payload.messages){
      const seconds=message?.create_time;
      if(validId(message?.id)&&message.author?.role==="user"&&
         message.metadata?.is_visually_hidden_from_conversation!==true&&
         message.metadata?.is_user_system_message!==true&&
         typeof seconds==="number"&&Number.isFinite(seconds)&&
         seconds>=946684800&&seconds<=Date.now()/1000+300)
        userTimes.push([message.id,Math.round(seconds*1000)]);
    }
    return {entries: core.summarizePage(payload.messages),userTimes,page_info: {
      has_previous_page: !!payload.page_info.has_previous_page,
      start_cursor: payload.page_info.start_cursor || null
    }};
  }
  function identify(value) {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith(historyPrefix)) return null;
      const id = url.pathname.slice(historyPrefix.length);
      return validId(id) ? {id, url} : null;
    } catch (_) { return null; }
  }
  function getArgs(input, init) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    return {url, method};
  }
  function publishPage(id,before,raw){
    const data={...summarize(raw),before};
    let pages=nativePages.get(id);
    if(!pages){pages=new Map();nativePages.set(id,pages);}
    pages.set(before||"",data);
    while(pages.size>32)pages.delete(pages.keys().next().value);
    while(nativePages.size>8)nativePages.delete(nativePages.keys().next().value);
    publish("native",{id,response:data});
  }
  // Explicitly user-requested history retrieval also supplies cached
  // metadata to both passive features without another network request.
  history.observePage((id,before,page)=>{
    try{publishPage(id,before,page);}catch{}
  });
  function captureResponse(id,before,response){
    if(response?.status===429)document.dispatchEvent(
      new Event("gpt-tweaks:history:rate-limited"));
    if(!response?.ok||!response.clone)return;
    const copy=response.clone();
    setTimeout(async()=>{
      try{publishPage(id,before,await copy.json());}
      catch{ /* Never affect ChatGPT's own response. */ }
    },0);
  }

  function captureOutgoing(input, init) {
    // The ordinary send request contains a stable user-message ID. Count it
    // immediately, then reconcile by ID when history is returned. No text is
    // transferred to the isolated world or stored on disk.
    const raw = init?.body;
    if (typeof raw !== 'string' || raw.length > 5000000) return;
    try {
      const packet = JSON.parse(raw);
      const id = packet.conversation_id || location.pathname.match(/(?:^|\/)c\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] || null;
      if (!Array.isArray(packet.messages)) return;
      const users = packet.messages.filter(m => m?.author?.role === 'user');
      if (users.length) document.dispatchEvent(new CustomEvent('ct-v1-outgoing', {detail:JSON.stringify({id:validId(id) ? id : null, entries:core.summarizePage(users)})}));
    } catch (_) { /* Unrecognized body shape: history reconciliation still works. */ }
  }

  // Passively observe ChatGPT's generation SSE on a clone. The original fetch
  // response (including its stream) is returned to the app untouched. Only
  // message IDs and numerical summaries are published across worlds.
  function observeGeneration(response, requestId) {
    if (!response?.ok || !response.body || !response.clone) return;
    const type = response.headers?.get('content-type') || '';
    if (!/text\/event-stream/i.test(type)) return;
    let copy;
    try { copy = response.clone(); } catch (_) { return; }
    void (async () => {
      const reader = copy.body.getReader();
      const decoder = new TextDecoder();
      const messages = new Map();
      const changed = new Set();
      let convoId = requestId;
      let currentId = null;
      let nextFlush = null;
      let buffer = '';
      let dataLines = [];
      let ended = false;
      let sawChanges = false;
      const flush = () => {
        clearTimeout(nextFlush);
        nextFlush = null;
        if (!changed.size) return;
        const entries = [];
        for (const id of changed) {
          const message = messages.get(id);
          const item = core.summarizeMessage(message);
          if (item) {
            // The streamed final reply may be visible before end_turn is set.
            // Count it provisionally, but never count intermediate commentary,
            // reasoning, or tool traffic as additional conversation messages.
            if (message.author?.role === 'assistant' &&
                message.recipient === 'all' &&
                message.channel === 'final' &&
                message.metadata?.is_visually_hidden_from_conversation !== true &&
                message.metadata?.reasoning_status !== 'is_reasoning' &&
                message.content?.content_type !== 'model_editable_context') {
              item[2] = 1;
            }
            entries.push(item);
          }
        }
        changed.clear();
        if (entries.length) {
          sawChanges = true;
          publishStream('update', entries);
        }
      };
      const publishStream = (type, entries = []) => {
        document.dispatchEvent(new CustomEvent('ct-v1-stream', {
          detail: JSON.stringify({type, id:validId(convoId) ? convoId : null, entries})
        }));
      };
      const mark = id => {
        changed.add(id);
        if (nextFlush === null) nextFlush = setTimeout(flush, 200);
      };
      const takeMessage = m => {
        if (!m || typeof m.id !== 'string' || !m.author?.role) return;
        currentId = m.id;
        messages.set(m.id, m);
        mark(m.id);
      };
      const applyOperation = op => {
        if (!op || typeof op.p !== 'string') return;
        if (op.p === '' && op.v?.message) { takeMessage(op.v.message); return; }
        if (!op.p.startsWith('/message/') || !currentId) return;
        const m = messages.get(currentId);
        if (!m) return;
        const path = op.p.slice('/message/'.length).split('/').map(part =>
          part.replace(/~1/g, '/').replace(/~0/g, '~'));
        if (!['content','author','metadata','recipient','channel','end_turn','status'].includes(path[0]) ||
            path.some(part => ['__proto__','prototype','constructor'].includes(part)) || path.length > 8) return;
        let parent = m;
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i];
          if (parent[key] == null) parent[key] = /^\d+$/.test(path[i + 1]) ? [] : {};
          if (!parent[key] || typeof parent[key] !== 'object') return;
          parent = parent[key];
        }
        const key = path[path.length - 1];
        if (op.o === 'append') {
          if (typeof op.v === 'string') parent[key] = (typeof parent[key] === 'string' ? parent[key] : '') + op.v;
          else if (Array.isArray(parent[key])) parent[key].push(op.v);
        } else if (op.o === 'add' && key === '-') {
          if (Array.isArray(parent)) parent.push(op.v);
        } else if (op.o === 'add' || op.o === 'replace') parent[key] = op.v;
        else return;
        mark(currentId);
      };
      const handleEvent = raw => {
        if (!raw || raw === '[DONE]') return;
        let packet;
        try { packet = JSON.parse(raw); } catch (_) { return; }
        if (!packet || typeof packet !== 'object') return;
        if (validId(packet.conversation_id)) convoId = packet.conversation_id;
        if (validId(packet.v?.conversation_id)) convoId = packet.v.conversation_id;
        if (packet.message) takeMessage(packet.message);
        // ChatGPT also introduces messages as {v:{message:...},c:N}
        // without a top-level operation. Without this, later /message/
        // patches are applied to the preceding message or discarded.
        if (packet.v?.message) takeMessage(packet.v.message);
        if (Array.isArray(packet.v)) for (const operation of packet.v) applyOperation(operation);
        else if (packet.o) applyOperation(packet);
      };
      const acceptLine = line => {
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line) {
          if (dataLines.length) handleEvent(dataLines.join('\n'));
          dataLines = [];
        } else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      };
      try {
        while (true) {
          const {value, done} = await reader.read();
          if (done) { ended = true; break; }
          buffer += decoder.decode(value, {stream:true});
          let boundary;
          while ((boundary = buffer.indexOf('\n')) !== -1) {
            acceptLine(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 1);
          }
          // Malformed or non-SSE streams must not grow memory without bound.
          if (buffer.length > 8_000_000) break;
        }
        if (ended) {
          buffer += decoder.decode();
          if (buffer) acceptLine(buffer);
          acceptLine('');
        }
      } catch (_) { /* Streaming can be aborted by ChatGPT navigation. */ }
      finally {
        flush();
        if (sawChanges || validId(convoId)) publishStream('done');
        if (!ended) void reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch (_) {}
      }
    })();
  }

  window.fetch = function (...args) {
    const {url, method} = getArgs(args[0], args[1]);
    let id = null, before=null;
    let generation = false;
    let generationId = null;
    if(method==="GET"){
      const match=identify(url);
      if(match){
        id=match.id;
        before=match.url.searchParams.get("before");
        if(!before)history.captureHeaders(id,args[0],args[1]);
      }
    } else if (method === 'POST' && trackingEnabled) {
      try {
        const u = new URL(url, location.href);
        if (u.origin === location.origin &&
            (u.pathname === '/backend-api/f/conversation' ||
             u.pathname === '/backend-api/conversation')) {
          generation = true;
          generationId = location.pathname.match(/(?:^|\/)c\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] || null;
          captureOutgoing(args[0], args[1]);
          document.dispatchEvent(new Event('ct-v1-activity'));
        }
      } catch (_) { /* Keep ChatGPT's request unchanged. */ }
    }
    const result = nativeFetch(...args);
    if (id) result.then(response => captureResponse(id,before,response), () => {});
    if (generation) result.then(response => observeGeneration(response, generationId), () => {
      document.dispatchEvent(new CustomEvent('ct-v1-stream', {
        detail: JSON.stringify({type:'done', id:generationId, entries:[]})
      }));
    });
    return result;
  };

  // The isolated script can arrive after the initial network response.
  document.addEventListener('ct-v1-bridge-ready', () => {
    // User timestamps still need passive native pages when tokens are disabled.
    for(const [id,pages] of nativePages)
      for(const response of pages.values())publish("native",{id,response});
  });
})();
