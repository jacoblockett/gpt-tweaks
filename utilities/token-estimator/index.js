(() => {
  'use strict';

  const core = globalThis.CTCore;
  if (!core || document.getElementById('ct-v1-marker')) return;

  // Passive only: never issue history requests for automatic token estimates.
  // Reuse ChatGPT's own history pages and the existing persistent numeric cache.
  // Cache entry format is internal and independent of the extension version.
  const ESTIMATE_ALGORITHM = 'network-text-deduplicated-fullscan-contextfix-finalcount';
  const storage = globalThis.GPTTweaksContextStorage;
  const view = globalThis.GPTTweaksContextIndicator(core);
  // The titlebar estimate is automatic, regardless of old display settings.
  let enabled = true;
  let activeId = null;
  let activeEntries = [];
  let complete = false;
  let generation = 0;
  let lastError = '';
  let expectedBefore = null;
  let hydrating = false;
  const pendingPages = [];
  const seenPages = new Set();
  let routeTimer = null;
  const streamEntries = new Map();
  // Numeric summaries for text-bearing stream records that the history API
  // omits (for example, hidden user instructions). Preserve across refreshes.
  const observedEntries = new Map();
  const blankChatStream = new Map();
  let streamFinished = false;

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
    view.render({activeEntries, observedEntries, streamEntries, complete,
      initialDiscovery, lastError});
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

  function acceptNativePage(id, page) {
    if(id!==activeId||!page||!Array.isArray(page.entries))return;
    if(hydrating){pendingPages.push(page);return;}
    const before=page.before||null;
    const signature=JSON.stringify([before,page.page_info?.start_cursor,
      page.entries.map(entry=>entry[0])]);
    if(seenPages.has(signature))return;
    const entries=core.uniqueEntries(page.entries);
    if(!before){
      const prior=activeEntries.slice(),priorComplete=complete;
      const joined=prior.length?core.reconcilePage(prior,entries,[]):null;
      if(joined){
        applyEntries(joined);
        complete=priorComplete||!page.page_info?.has_previous_page;
      }else if(!prior.length){
        applyEntries(entries);
        complete=!page.page_info?.has_previous_page;
      }else{
        // Do not claim a complete estimate without an overlapping page.
        applyEntries(core.uniqueEntries([...prior,...entries]));
        complete=false;
      }
      expectedBefore=page.page_info?.has_previous_page?
        page.page_info.start_cursor:null;
    }else{
      // Only join a proven contiguous pagination chain.
      if(before!==expectedBefore)return;
      applyEntries(core.mergeOlder(entries,activeEntries));
      expectedBefore=page.page_info?.has_previous_page?
        page.page_info.start_cursor:null;
      if(!page.page_info?.has_previous_page)complete=true;
    }
    seenPages.add(signature);
    initialDiscovery=false;
    render();
    void save(id,activeEntries.slice(),complete);
  }

  function onHistoryMessage(event) {
    let message;
    try{message=JSON.parse(event.detail);}catch{return;}
    if(message?.type==="native"&&message.id===activeId)
      acceptNativePage(message.id,message.response);
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

  async function switchConversation(id, firstSend = false) {
    generation++;
    // The status resets immediately when the conversation changes.
    activeId = id;
    activeEntries = [];
    complete = false;
    lastError = '';
    expectedBefore=null;
    seenPages.clear();pendingPages.length=0;
    hydrating=!!id;
    pendingOutgoing.clear();
    streamEntries.clear();
    observedEntries.clear();
    streamFinished = false;
    initialDiscovery = !firstSend;
    view.setConversation(id);
    render();
    if (!id) {
      hydrating=false;
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
    initialDiscovery=false;
    hydrating=false;
    for(const page of pendingPages.splice(0))acceptNativePage(id,page);
    render();
    // Replay only previously observed native pages, never start a new fetch.
    document.dispatchEvent(new Event('ct-v1-bridge-ready'));
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
      // Reconcile only when ChatGPT itself supplies a history page.
      // A streaming event must never launch extension-owned pagination.
    }
  }

  async function refreshEnabled() {
    try {
      const settings = await storage.preferences();
      const wasEnabled = enabled;
      enabled = settings.enabled !== false;
      document.dispatchEvent(new CustomEvent('ct-v1-tracker-enabled',
        {detail:enabled ? 'true' : 'false'}));
      view.setVisible(enabled);
      if(!wasEnabled&&enabled&&activeId)
        document.dispatchEvent(new Event('ct-v1-bridge-ready'));
    } catch (error) {
      console.warn('[GPT Tweaks Token Estimator] Cannot read settings:', error);
    }
  }

  async function start() {
    document.addEventListener('ct-v1-history', onHistoryMessage);
    document.addEventListener('ct-v1-outgoing', onOutgoing);
    document.addEventListener('ct-v1-activity', scheduleActivitySync);
    document.addEventListener('ct-v1-stream', onStream);
    await refreshEnabled();
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
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === 'gpt-tweaks:context:settings-changed')
        void refreshEnabled();
    });

  }

  void start();
})();