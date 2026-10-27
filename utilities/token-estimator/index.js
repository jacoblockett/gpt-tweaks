(() => {
  'use strict';

  const core = globalThis.CTCore;
  if (!core || document.getElementById('ct-v1-marker')) return;

  const DEFAULT_TARGET = 512000;
  // Generation streams drive updates and completion reconciliation; history
  // retrieval remains available for old conversations and recovery.
  const MAX_PAGES = 200;
  const MAX_RECORDS = 100000;
  const PAGE_TURNS = 10;
  const SYNC_TURNS = 2;
  // Cache entry format is internal and independent of the extension version.
  const ESTIMATE_ALGORITHM = 'network-text-deduplicated-fullscan-contextfix-finalcount';
  const storage = globalThis.GPTTweaksContextStorage;
  const view = globalThis.GPTTweaksContextIndicator(core);
  let enabled = true;
  let defaultVisible = false;
  let initialVisibility = null; // Snapshot when the current chat is loaded.
  let visibility = null; // Manual choice, null until the chat is touched.
  let flags = {percent:true, tokens:true, limit:true};

  let target = DEFAULT_TARGET;
  let activeId = null;
  let activeEntries = [];
  let complete = false;
  let requestSequence = 0;
  const pendingRequests = new Map();
  let running = false;
  let queued = false;
  let generation = 0;
  let fetchController = null;
  let lastSync = 0;
  let lastError = '';
  let routeTimer = null;
  const streamEntries = new Map();
  // Numeric summaries for text-bearing stream records that the history API
  // omits (for example, hidden user instructions). Preserve across refreshes.
  const observedEntries = new Map();
  const blankChatStream = new Map();
  let streamFinished = false;
  let nativeSeed = null;
  let firstSyncTimer = null;
  // A failed history URL is not proof that future requests will fail. Allow
  // later user activity to retry with bounded backoff instead of blacklisting.
  let historyRetryAfter = 0;
  let history404Streak = 0;
  let initialDiscovery = true;
  // A first send starts on an ID-less page, before ChatGPT updates the URL.
  let blankChatSent = false;
  const blankChatOutgoing = new Map();
  const pendingOutgoing = new Map();

  function conversationId() {
    // ChatGPT project threads live under /g/<project>/c/<id>; ordinary
    // threads live under /c/<id>. They share the same conversation identity.
    const match = location.pathname.match(/(?:^|\/)c\/([0-9a-fA-F-]{36})(?:\/|$)/);
    return match ? match[1].toLowerCase() : null;
  }

  function render() {
    view.render({activeEntries, observedEntries, streamEntries, target, complete,
      initialDiscovery, lastError, flags});
  }
  function validCached(value) {
    return value && value.version === 1 && value.algorithm === ESTIMATE_ALGORITHM && Array.isArray(value.entries) &&
      value.entries.every(e => Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(e[1])) &&
      (!('observedEntries' in value) || (Array.isArray(value.observedEntries) &&
        value.observedEntries.every(e => Array.isArray(e) && typeof e[0] === 'string' &&
          Number.isFinite(e[1]) && (e[2] === 0 || e[2] === 1))));
  }

  async function save(id, entries, isComplete) {
    const payload = {version:1, algorithm:ESTIMATE_ALGORITHM, entries,
      observedEntries:[...observedEntries.values()], complete:isComplete, updated:Date.now()};
    try { await storage.save(id, payload); }
    catch (err) { lastError = `Could not save estimates locally (${String(err)})`; }
  }

  async function load(id) {
    let snapshot = null;
    try {
      const value = await storage.load(id);
      if (validCached(value)) snapshot = value;
    } catch (err) { lastError = String(err); }
    return snapshot;
  }

  function fetchPage(id, before, pageSize, signal) {
    return new Promise((resolve, reject) => {
      const seq = ++requestSequence;
      const timeout = setTimeout(() => {
        pendingRequests.delete(seq);
        reject(new Error('Timed out reading ChatGPT conversation history'));
      }, 18000);
      const finish = (error, data) => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        pendingRequests.delete(seq);
        if (error) reject(error);
        else resolve(data);
      };
      const onAbort = () => {
        document.dispatchEvent(new CustomEvent('ct-v1-history-cancel', {detail: String(seq)}));
        finish(new DOMException('Canceled', 'AbortError'));
      };
      if (signal?.aborted) return onAbort();
      pendingRequests.set(seq, finish);
      signal?.addEventListener('abort', onAbort, {once:true});
      document.dispatchEvent(new CustomEvent('ct-v1-history-request', {
        detail: JSON.stringify({seq,id,before,pageSize})
      }));
    });
  }

  function acceptNativePage(id, page) {
    if (id !== activeId || !page || !Array.isArray(page.entries)) return;
    nativeSeed = page;
    historyRetryAfter = 0;
    history404Streak = 0;
    if (!running) {
      clearTimeout(firstSyncTimer);
      firstSyncTimer = null;
      void syncHistory(id, generation);
    }
  }

  function onHistoryMessage(event) {
    let message;
    try { message = JSON.parse(event.detail); } catch (_) { return; }
    if (!message || message.id !== activeId) return;
    if (message.type === 'native') { acceptNativePage(message.id, message.response); return; }
    if ((message.type === 'result' || message.type === 'error') && pendingRequests.has(message.seq)) {
      pendingRequests.get(message.seq)(
        message.type === 'error' ? new Error(message.error || 'History request failed') : null,
        message.response
      );
    }
  }

  function applyEntries(entries) {
    // Local outgoing messages are optimistic until the server confirms them.
    // Keep their message IDs so the history snapshot cannot double-count them.
    const confirmed = new Set(entries.map(e => e[0]));
    for (const id of confirmed) {
      pendingOutgoing.delete(id);
      observedEntries.delete(id);
      if (streamFinished) streamEntries.delete(id);
    }
    activeEntries = core.uniqueEntries([...entries, ...pendingOutgoing.values()]);
    render();
  }

  function onOutgoing(event) {
    if (!enabled) return;
    let message;
    try { message = JSON.parse(event.detail); } catch (_) { return; }
    if (!Array.isArray(message?.entries)) return;
    if (!activeId) {
      // The first request may precede the URL acquiring a conversation ID.
      // Keep only numeric summaries until we know the new thread ID.
      blankChatSent = true;
      for (const e of message.entries) {
        if (Array.isArray(e) && typeof e[0] === 'string') blankChatOutgoing.set(e[0], e);
      }
      return;
    }
    if (message.id !== activeId) return;
    const known = new Set(activeEntries.map(e => e[0]));
    let added = false;
    for (const e of message.entries) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || known.has(e[0])) continue;
      pendingOutgoing.set(e[0], e);
      activeEntries.push(e);
      known.add(e[0]);
      added = true;
    }
    if (added) {
      // A send is a user-visible update; do not wait for an assistant reply.
      render();
      void save(activeId, activeEntries.slice(), complete);
    }
  }

  async function syncHistory(id, serial) {
    if (!enabled) return;
    if (running) { queued = true; return; }
    if (Date.now() < historyRetryAfter) return;
    running = true;
    lastError = '';
    fetchController = new AbortController();
    const signal = fetchController.signal;
    let pages = 0;
    let cursor = null;
    let newerEntries = [];
    let sawEnd = false;
    const cached = complete ? activeEntries.slice() : null;
    const seed = nativeSeed;
    nativeSeed = null;
    if (seed) {
      newerEntries = core.uniqueEntries(seed.entries);
      // A cached complete history may already contain this page. Preserve all
      // earlier messages while replacing updated recent records and branches.
      const reconciled = cached ? core.reconcilePage(cached, newerEntries, []) : null;
      if (reconciled) {
        applyEntries(reconciled);
        complete = true;
        await save(id, activeEntries, true);
        running = false;
        fetchController = null;
        initialDiscovery = false;
        render();
        lastSync = Date.now();
        return;
      }
      applyEntries(newerEntries);
      complete = !seed.page_info.has_previous_page;
      if (complete) {
        await save(id, activeEntries, true);
        running = false;
        fetchController = null;
        initialDiscovery = false;
        render();
        lastSync = Date.now();
        return;
      }
      cursor = seed.page_info.start_cursor;
    }
    const previousCursors = new Set();
    try {
      while (pages < MAX_PAGES && newerEntries.length < MAX_RECORDS) {
        if (generation !== serial || activeId !== id) return;
        const response = await fetchPage(id, cursor, cached ? SYNC_TURNS : PAGE_TURNS, signal);
        const part = response.entries;
        pages++;
        if (generation !== serial || activeId !== id) return;
        let updated = cached ? core.reconcilePage(cached, part, newerEntries) : null;
        if (updated) {
          applyEntries(updated);
          complete = true;
          sawEnd = true;
          await save(id, activeEntries, true);
          break;
        }
        newerEntries = core.mergeOlder(part, newerEntries);
        if (!cached) {
          applyEntries(newerEntries);
          complete = false;
        }
        const info = response.page_info;
        if (!info.has_previous_page) {
          applyEntries(newerEntries);
          complete = true;
          sawEnd = true;
          await save(id, activeEntries, true);
          break;
        }
        if (!info.start_cursor || previousCursors.has(info.start_cursor)) throw new Error('History pagination did not advance');
        cursor = info.start_cursor;
        previousCursors.add(cursor);
        // A small delay prevents a rapid burst of authenticated requests.
        await new Promise(resolve => setTimeout(resolve, 700));
        if (document.hidden) break;
      }
      if (!sawEnd && newerEntries.length) {
        applyEntries(cached ? core.uniqueEntries([...cached, ...newerEntries]) : newerEntries);
        await save(id, activeEntries, false);
      }
      lastSync = Date.now();
      history404Streak = 0;
      historyRetryAfter = 0;
    } catch (err) {
      if (signal.aborted || generation !== serial) return;
      lastError = err instanceof Error ? err.message : String(err);
      if (/HTTP 404/.test(lastError)) {
        history404Streak++;
        historyRetryAfter = Date.now() + Math.min(300000, 15000 * 2 ** Math.min(5, history404Streak - 1));
      }
      console.warn('[GPT Tweaks Token Estimator] Cannot load history:', lastError);
      if (newerEntries.length) await save(id, activeEntries, false);
    } finally {
      if (generation === serial) {
        running = false;
        fetchController = null;
        initialDiscovery = false;
        render();
        if (queued) { queued = false; void syncHistory(id, serial); }
      }
    }
  }

  async function switchConversation(id, firstSend = false) {
    generation++;
    clearTimeout(firstSyncTimer);
    if (fetchController) fetchController.abort();
    running = false;
    queued = false;
    // The default is sampled only when loading a conversation, not when
    // the setting changes. Preserve an untitled chat's manual selection
    // across its first send and assignment of a conversation ID.
    const preserveUntitled = firstSend && activeId === null;
    if (!preserveUntitled) {
      visibility = null;
      initialVisibility = defaultVisible;
    }
    view.setVisible(enabled && (visibility ?? initialVisibility));
    activeId = id;
    activeEntries = [];
    complete = false;
    lastError = '';
    lastSync = 0;
    historyRetryAfter = 0;
    history404Streak = 0;
    nativeSeed = null;
    pendingOutgoing.clear();
    streamEntries.clear();
    observedEntries.clear();
    streamFinished = false;
    initialDiscovery = !firstSend;
    view.setConversation(null);
    if (!id) {
      blankChatSent = false;
      blankChatOutgoing.clear();
      blankChatStream.clear();
      return;
    }
    if (firstSend) {
      for (const [messageId, e] of blankChatOutgoing) pendingOutgoing.set(messageId, e);
      for (const [messageId, e] of blankChatStream) streamEntries.set(messageId, e);
      activeEntries = core.uniqueEntries([...pendingOutgoing.values()]);
    }
    blankChatSent = false;
    blankChatOutgoing.clear();
    blankChatStream.clear();
    const serial = generation;
    // A manual choice belongs to the conversation, including later visits.
    // Keep the display unmounted until its saved visibility has been read.
    let savedVisibility = null;
    try { savedVisibility = await storage.getVisibility(id); }
    catch (error) { console.warn('[GPT Tweaks] Cannot load token estimator visibility:', error); }
    if (generation !== serial) return;
    if (visibility === null && typeof savedVisibility === 'boolean') visibility = savedVisibility;
    else if (preserveUntitled && typeof visibility === 'boolean') {
      void storage.setVisibility(id, visibility).catch(error =>
        console.warn('[GPT Tweaks] Cannot save token estimator visibility:', error));
    }
    view.setVisible(enabled && (visibility ?? initialVisibility));
    view.setConversation(id);
    const cached = await load(id);
    if (generation !== serial) return;
    if (cached) {
      for (const e of cached.observedEntries || []) observedEntries.set(e[0], e);
      const known = new Set(cached.entries.map(e => e[0]));
      for (const id of known) pendingOutgoing.delete(id);
      activeEntries = core.uniqueEntries([...cached.entries, ...pendingOutgoing.values()]);
      complete = !!cached.complete;
      // Stored estimates appear immediately; only a previously unknown
      // conversation should show the initial-discovery spinner.
      initialDiscovery = false;
    }
    render();
    // The original page request is the preferred history source. The
    // fallback is one delayed request only, not a recurring fetch loop.
    document.dispatchEvent(new Event('ct-v1-bridge-ready'));
    firstSyncTimer = setTimeout(() => {
      if (enabled && generation === serial && activeId === id && !running && !nativeSeed && !complete)
        void syncHistory(id, serial);
    }, 4500);
  }

  function scheduleActivitySync() {
    if (!activeId) blankChatSent = true;
    // The generation stream, not guessed 8/45-second delays, drives updates.
  }

  function onStream(event) {
    if (!enabled) return;
    let packet;
    try { packet = JSON.parse(event.detail); } catch (_) { return; }
    if (!packet || !['update', 'done'].includes(packet.type)) return;
    const id = packet.id;
    if (packet.type === 'update') {
      if (!Array.isArray(packet.entries)) return;
      const destination = activeId && (!id || id === activeId) ? streamEntries :
        !activeId && blankChatSent ? blankChatStream : null;
      if (!destination) return;
      for (const e of packet.entries) {
        if (Array.isArray(e) && typeof e[0] === 'string' &&
            Number.isFinite(e[1]) && (e[2] === 0 || e[2] === 1)) destination.set(e[0], e);
      }
      streamFinished = false;
      if (activeId && destination.size) initialDiscovery = false;
      render();
      return;
    }
    if (activeId && (!id || id === activeId)) {
      streamFinished = true;
      // The history endpoint omits some textual stream-only context records.
      // Keep their numeric summaries even if a reload happens before the
      // authoritative history reconciliation finishes.
      for (const [messageId, entry] of streamEntries) {
        if (entry[1] > 0) observedEntries.set(messageId, entry);
      }
      void save(activeId, activeEntries.slice(), complete);
      // Stream EOF replaces the old 8/45-second polling guesses. Reconcile
      // provisional message IDs with the actual persisted history.
      historyRetryAfter = 0;
      if (running) queued = true;
      else void syncHistory(activeId, generation);
    }
  }

  function toggleTokens() {
    if (!enabled) return;
    visibility = !(visibility ?? initialVisibility);
    view.setVisible(visibility);
    if (activeId) {
      void storage.setVisibility(activeId, visibility).catch(error =>
        console.warn('[GPT Tweaks] Cannot save token estimator visibility:', error));
    }
    render();
  }

  // Register via the same shared menu API as GitHub Source.
  globalThis.GPTTweaksContextTokens = Object.freeze({
    isEnabled:async method => {
      const settings = await storage.preferences();
      return settings.enabled !== false && settings[method] !== false;
    },
    activate:toggleTokens
  });

  async function refreshPreferences() {
    try {
      const settings = await storage.preferences();
      const previouslyEnabled = enabled;
      enabled = settings.enabled !== false;
      document.dispatchEvent(new CustomEvent('ct-v1-tracker-enabled',
        {detail:enabled ? 'true' : 'false'}));
      if (!enabled) fetchController?.abort();
      const nextDefault = settings.defaultVisible === true;
      // New defaults affect only subsequently loaded chats. Do not change
      // this chat's display, whether or not it has been toggled manually.
      if (initialVisibility === null) initialVisibility = nextDefault;
      defaultVisible = nextDefault;
      if (Number.isSafeInteger(settings.target) && settings.target > 0) target = settings.target;
      flags = {percent:settings.percent !== false, tokens:settings.tokens !== false,
        limit:settings.limit !== false};
      view.setVisible(enabled && (visibility ?? initialVisibility));
      render();
      if (enabled && !previouslyEnabled && activeId) {
        document.dispatchEvent(new Event('ct-v1-bridge-ready'));
        if (!running) void syncHistory(activeId, generation);
      }
    } catch (error) {
      console.warn('[GPT Tweaks] Cannot load token estimator settings:', error);
    }
  }
  async function start() {
    document.addEventListener('ct-v1-history', onHistoryMessage);
    document.addEventListener('ct-v1-outgoing', onOutgoing);
    document.addEventListener('ct-v1-activity', scheduleActivitySync);
    document.addEventListener('ct-v1-stream', onStream);
    await refreshPreferences();
    void switchConversation(conversationId());
    let lastUrl = location.href;
    function onNavigation() {
      const current = location.href;
      if (current === lastUrl) return;
      lastUrl = current;
      const id = conversationId();
      if (id !== activeId) void switchConversation(id, !!id && !activeId && blankChatSent);
      // React can replace the composer on the next render.
      setTimeout(() => { if (activeId && !view.isMounted()) view.mount(); }, 150);
    }
    window.addEventListener('popstate', onNavigation);
    window.addEventListener('pageshow', onNavigation);
    // Stylesheets and initial hydration may finish without subtree changes.
    window.addEventListener('load', () => { if (activeId && !view.isMounted()) view.mount(); });
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
      window.navigation.addEventListener('currententrychange', onNavigation);
    } else {
      // Legacy browsers only: minimal URL check, never a subtree scan.
      routeTimer = setInterval(() => {
        onNavigation();
        if (activeId && !view.isMounted()) view.mount();
      }, 3000);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (enabled && activeId && (!complete || Date.now() - lastSync > 30000)) {
        void syncHistory(activeId, generation);
      }
      view.updateTheme();
    });
    window.addEventListener('resize', () => {
      view.align();
    });
    // Theme switches are infrequent, unlike transcript mutations.
    const themeObserver = new MutationObserver(() => {
      view.updateTheme();
    });
    themeObserver.observe(document.documentElement, {attributes:true, attributeFilter:['data-theme','data-appearance-theme','class','style']});
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === 'gpt-tweaks:context:settings-changed') void refreshPreferences();
    });
  }

  void start();
})();