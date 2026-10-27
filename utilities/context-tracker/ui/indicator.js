/* Native-composer appearance and lifecycle for the context tracker. */
(() => {
  'use strict';
  const sheet = `
    :host { display:block; position:relative; z-index:1; box-sizing:border-box;
      align-self:stretch; width:100%; max-width:100%; min-width:0;
      height:52px; flex:none; margin-bottom:0; container-type:inline-size;
      background-color:var(--composer-layout-surface-background, var(--ct-surface-fallback, #1b1b1b));
      -webkit-backdrop-filter:var(--composer-layout-surface-backdrop-filter, none);
      backdrop-filter:var(--composer-layout-surface-backdrop-filter, none);
      border:0; border-radius:var(--ct-corner-radius, 28px) var(--ct-corner-radius, 28px) 0 0;
      --ct-accent:var(--color-background-composer-primary, #7849d1);
      --ct-warning:#eab308;
      --ct-alert:var(--app-color-decoration-deleted, #fa423e);
      color:var(--color-text, #ededed); font:inherit; text-align:left; line-height:normal; }
    *, *::before, *::after { box-sizing:border-box; }
    #tracker { display:flex; align-items:center; gap:14px; width:100%; height:52px;
      border:0; padding:10px 18px; background:transparent; color:inherit; }
    .metrics { display:inline-flex; align-items:center; gap:8px; flex:none;
      min-width:0; font:inherit; font-size:13px; font-weight:400; line-height:20px;
      font-variant-numeric:tabular-nums; white-space:nowrap; }
    .numbers { display:inline-flex; align-items:baseline; gap:0; }
    .numbers[hidden], #percentage[hidden], #used[hidden], #target-wrap[hidden], #status[hidden] { display:none; }
    #target { display:inline-block; min-width:1ch; border-radius:3px;
      border-bottom:1px dotted color-mix(in srgb, currentColor 50%, transparent);
      cursor:text; outline:none; white-space:nowrap; user-select:text; }
    #target:hover { border-bottom-style:solid; }
    #target:focus { outline:1px solid var(--ct-accent); outline-offset:3px;
      border-bottom-color:transparent; }
    #percentage { margin-left:5px; }
    #status { display:none; align-items:center; color:var(--ct-alert); font-weight:400;
      padding:2px 7px; border-radius:999px;
      background:color-mix(in srgb, var(--ct-alert) 13%, transparent); font-size:12px; }
    :host([data-over-target]) #status:not([hidden]) { display:inline-flex; }
    .track { display:block; flex:1 1 auto; width:100%; min-width:55px;
      height:6px; overflow:hidden; background:color-mix(in srgb, var(--color-text, #ededed) 15%, transparent);
      border-radius:99px; }
    #fill { display:block; width:0; height:100%; background:var(--ct-accent);
      border-radius:inherit; transition:width 220ms ease,background-color 180ms ease; }
    :host([data-over-target]) #fill { background:var(--ct-alert); }
    :host([data-over-target]) .track { box-shadow:0 0 0 1px color-mix(in srgb,var(--ct-alert) 28%,transparent); }
    .loading { display:none; align-items:center; justify-content:center; gap:11px;
      font-size:14px; height:100%; color:inherit; white-space:nowrap; }
    .spinner { width:16px; height:16px; border-radius:50%; flex:none;
      border:2px solid color-mix(in srgb, var(--color-text, #ededed) 35%, transparent);
      border-top-color:var(--ct-accent); animation:ct-spin 700ms linear infinite; }
    @keyframes ct-spin { to { transform:rotate(360deg); } }
    #tracker[data-phase="loading"] .metrics, #tracker[data-phase="loading"] .track { display:none; }
    #tracker[data-phase="loading"] .loading { display:flex; }
    @container (max-width:680px) { #tracker { gap:8px; padding-inline:11px; }
      .metrics { gap:4px; font-size:12px; } #status { display:none !important; } }
    @container (max-width:370px) { #tracker { flex-wrap:wrap; gap:2px; }
      .track { flex-basis:100%; } }
    @media (prefers-reduced-motion:reduce) { #fill { transition:none; } .spinner { animation:none; } }
  `;
  const num = value => {
    const raw = String(value);
    if (raw.includes('e')) return raw; // Preserve tiny/huge numeric targets.
    const [whole, fraction] = raw.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction === undefined ? grouped : `${grouped}.${fraction}`;
  };

  // Accept grouping separators and optional decimals; store a positive whole token.
  const parseTarget = value => {
    const raw = String(value).trim().replace(/,/g, '');
    if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
    const rounded = Math.max(1, Math.round(Number(raw)));
    return Number.isSafeInteger(rounded) ? rounded : null;
  };

  globalThis.GPTTweaksContextIndicator = (core, saveTarget) => {
    let activeId = null;
    let currentState = null;
    let ui = null;
    let host = null;
    let visible = false;
    let disclaimerContainer = null;
    let disclaimerContainerDisplay = null;
    let composerObserver = null;
    let roundedComposer = [];
    let pendingMountObserver = null;
    let mountTimer = null;
    let editingTarget = false;
    let cancelTarget = false;
  function findDisclaimer() {
    const candidates = document.querySelectorAll('[data-markdown-copy="exclude"]');
    for (const e of candidates) {
      if (e.children.length === 0 && /^ChatGPT can make mistakes\./.test(e.textContent.trim())) return e;
    }
    return null;
  }

  function createUI() {
    const rootHost = document.createElement('div');
    rootHost.id = 'ct-v1-marker';
    const shadow = rootHost.attachShadow({mode:'closed'});
    const css = new CSSStyleSheet();
    css.replaceSync(sheet);
    shadow.adoptedStyleSheets = [css];
    const panel = document.createElement('div');
    panel.id = 'tracker';
    panel.innerHTML = `
      <span class="metrics"><span class="numbers" id="numbers">
        <span id="used">0</span><span id="separator"> / </span><span id="target-wrap"><span id="target" contenteditable="plaintext-only" inputmode="decimal" role="textbox" aria-label="Edit target tokens" aria-multiline="false" spellcheck="false">512,000</span></span>
        <span id="tokens-label"> Tokens</span><span id="percentage"> (0.0%)</span>
      </span><span id="status">Target Exceeded</span></span>
      <span class="track" id="progress" role="progressbar" aria-label="Estimated conversation length against custom token target" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="fill"></span></span>
      <span class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Calculating current session metrics</span>`;
    shadow.append(panel);
    const targetValue = shadow.querySelector('#target');
    targetValue.addEventListener('focus', () => { editingTarget = true; cancelTarget = false; });
    targetValue.addEventListener('keydown', event => {
      // Prevent composer shortcuts while editing the target. Tab retains normal navigation.
      if (event.key === 'Escape') {
        cancelTarget = true;
        event.preventDefault();
        targetValue.blur();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        targetValue.blur();
      } else if (event.key !== 'Tab') event.stopPropagation();
    });
    targetValue.addEventListener('beforeinput', event => {
      if (event.data && !/^[\d.,]+$/.test(event.data)) event.preventDefault();
      // No line breaks in the numeric field.
      if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak')
        event.preventDefault();
    });
    targetValue.addEventListener('blur', () => {
      editingTarget = false;
      const candidate = cancelTarget ? null : parseTarget(targetValue.textContent);
      cancelTarget = false;
      if (!candidate || !currentState || candidate === currentState.target) {
        render(); // Restore the current formatted value after cancel/invalid edits.
        return;
      }
      targetValue.textContent = num(candidate);
      void Promise.resolve(saveTarget(candidate)).then(ok => {
        if (!ok) render();
      }).catch(() => render());
    });
    return {rootHost, panel,
      numbers:shadow.querySelector('#numbers'), used:shadow.querySelector('#used'),
      separator:shadow.querySelector('#separator'), target:targetValue,
      targetWrap:shadow.querySelector('#target-wrap'),
      tokensLabel:shadow.querySelector('#tokens-label'),
      percent:shadow.querySelector('#percentage'),
      progress:shadow.querySelector('#progress'), fill:shadow.querySelector('#fill'),
      status:shadow.querySelector('#status')};
  }

  function removeUI() {
    pendingMountObserver?.disconnect();
    pendingMountObserver = null;
    clearTimeout(mountTimer);
    mountTimer = null;
    composerObserver?.disconnect();
    composerObserver = null;
    restoreComposerCorners();
    if (host?.isConnected) host.remove();
    if (disclaimerContainer) {
      if (disclaimerContainerDisplay?.value) {
        disclaimerContainer.style.setProperty('display', disclaimerContainerDisplay.value,
          disclaimerContainerDisplay.priority);
      } else disclaimerContainer.style.removeProperty('display');
    }
    disclaimerContainer = null;
    disclaimerContainerDisplay = null;
  }

  function findComposerForm() {
    return document.querySelector('form[data-chatgpt-composer][data-composer-placement="thread"]') ||
      document.querySelector('[data-composer-body]')?.closest('form') || null;
  }

  function updateComposerTheme(form) {
    if (!host || !ui) return;
    const composerRoot = form.querySelector('[data-composer-dark]');
    const surface = composerRoot?.parentElement;
    if (!surface) return;
    // Composer-specific variables can be scoped below our sibling's parent.
    // Copy their computed values onto the host so the tracker uses the exact
    // same native surface, including when switching light/dark themes.
    const element = form.querySelector('[class*="ComposerLayoutRoot-"]') ||
      form.querySelector('[class*="ComposerLayoutBody-"]') || composerRoot;
    const styles = [getComputedStyle(element), getComputedStyle(composerRoot), getComputedStyle(surface)];
    const read = name => styles.map(style => style.getPropertyValue(name).trim()).find(Boolean);
    const nativeText = read('--color-text');
    if (nativeText) {
      host.style.setProperty('--color-text', nativeText);
    }
    const background = read('--composer-layout-surface-background');
    for (const element of [host]) {
      if (background) element.style.setProperty('--composer-layout-surface-background', background);
      else element.style.removeProperty('--composer-layout-surface-background');
    }
    const nativeBackground = styles.map(style => style.backgroundColor)
      .find(color => color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)');
    if (nativeBackground) {
      host.style.setProperty('--ct-surface-fallback', nativeBackground);
    }
    const backdrop = read('--composer-layout-surface-backdrop-filter');
    if (backdrop) host.style.setProperty('--composer-layout-surface-backdrop-filter', backdrop);
    else host.style.removeProperty('--composer-layout-surface-backdrop-filter');
    // The send button uses this native theme variable. Preserve it directly
    // rather than sampling a potentially different voice button background.
    const accent = read('--color-background-composer-primary');
    for (const element of [host]) {
      if (accent) element.style.setProperty('--color-background-composer-primary', accent);
      else element.style.removeProperty('--color-background-composer-primary');
    }
  }

  function joinComposerCorners(composerRoot, surface) {
    // The standalone native input has rounded top corners. As a continuous
    // two-part control, the tracker owns the top corners instead. Restore
    // native inline declarations when the extension unmounts.
    for (const element of new Set([surface, composerRoot])) {
      const saved = {};
      for (const name of ['border-top-left-radius', 'border-top-right-radius']) {
        saved[name] = {
          value:element.style.getPropertyValue(name),
          priority:element.style.getPropertyPriority(name)
        };
        element.style.setProperty(name, '0px', 'important');
      }
      roundedComposer.push({element, saved});
    }
  }

  function restoreComposerCorners() {
    for (const {element, saved} of roundedComposer) {
      for (const [name, {value, priority}] of Object.entries(saved)) {
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
      }
    }
    roundedComposer = [];
  }

  function alignWithComposer(surface) {
    // A layout's apparent spacing may come from margins or other rules,
    // not just row-gap. Measure the actual seam after insertion.
    host.style.marginBottom = '0px';
    const seam = surface.getBoundingClientRect().top - host.getBoundingClientRect().bottom;
    if (Number.isFinite(seam)) host.style.marginBottom = `${-seam - 1}px`;
  }

  function scheduleMount() {
    if (mountTimer !== null || !activeId || !visible) return;
    mountTimer = setTimeout(() => {
      mountTimer = null;
      mount();
    }, 80);
  }

  function awaitComposer() {
    if (pendingMountObserver || !activeId || !visible) return;
    // Observe only during hydration or a React composer replacement. Once the
    // control is mounted, stop observing the document subtree entirely.
    const root = document.body || document.documentElement;
    if (!root) return;
    pendingMountObserver = new MutationObserver(scheduleMount);
    // ChatGPT can hydrate an existing composer by changing its attributes
    // without inserting a new node. Observe only while the tracker is absent.
    pendingMountObserver.observe(root, {
      childList:true, subtree:true, attributes:true,
      attributeFilter:['class', 'style', 'data-composer-dark', 'data-composer-placement', 'data-composer-layout']
    });
  }

  function watchComposer(form, layout) {
    composerObserver?.disconnect();
    composerObserver = new MutationObserver(() => {
      const currentSurface = form.querySelector('[data-composer-dark]')?.parentElement;
      if (!host?.isConnected || !form.isConnected || !currentSurface ||
          host.nextElementSibling !== currentSurface || host.parentElement !== currentSurface.parentElement) {
        scheduleMount();
      } else {
        // Attribute-only layout changes can alter the seam after mounting.
        alignWithComposer(currentSurface);
      }
    });
    // Observe immediate composer layout changes and ancestor replacement,
    // not the chat transcript or other unrelated document mutations.
    composerObserver.observe(layout, {childList:true, attributes:true, attributeFilter:['class']});
    composerObserver.observe(layout.parentElement, {childList:true});
    for (let ancestor = form; ancestor; ancestor = ancestor.parentElement) {
      composerObserver.observe(ancestor, {childList:true});
      if (ancestor === document.body) break;
    }
  }

  function hideDisclaimer() {
    if (disclaimerContainer?.isConnected) return;
    const disclaimer = findDisclaimer();
    if (!disclaimer?.parentElement) return;
    disclaimerContainer = disclaimer.parentElement;
    disclaimerContainerDisplay = {
      value: disclaimerContainer.style.getPropertyValue('display'),
      priority: disclaimerContainer.style.getPropertyPriority('display')
    };
    disclaimerContainer.style.setProperty('display', 'none', 'important');
  }

  function mount() {
    if (!activeId || !visible) { removeUI(); return; }
    const form = findComposerForm();
    if (!form) { awaitComposer(); return; }
    const composerRoot = form.querySelector('[data-composer-dark]');
    const surface = composerRoot?.parentElement;
    const layout = surface?.parentElement;
    // Never fall back to the outer form. Its gap creates a visible seam and
    // causes the native full-width footer backdrop to obscure transcript text.
    if (!surface || !layout || getComputedStyle(layout).display !== 'flex') {
      awaitComposer(); return;
    }
    if (!ui) { ui = createUI(); host = ui.rootHost; }
    if (host.isConnected && host.parentElement === layout && host.nextElementSibling === surface) {
      hideDisclaimer(); return;
    }

    removeUI();
    hideDisclaimer();
    const rootRadius = Number.parseFloat(getComputedStyle(composerRoot).borderTopLeftRadius) || 0;
    const surfaceRadius = Number.parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 0;
    host.style.setProperty('--ct-corner-radius', `${Math.max(0, rootRadius || surfaceRadius || 28)}px`);
    layout.insertBefore(host, surface);
    alignWithComposer(surface);
    joinComposerCorners(composerRoot, surface);
    watchComposer(form, layout);
    updateComposerTheme(form);
    render();
  }

  function render(state = currentState) {
    currentState = state;
    if (!state || !ui || !host || !host.isConnected) return;
    const {activeEntries, observedEntries, streamEntries, target, complete,
      initialDiscovery, lastError, flags} = state;
    // Streaming entries replace, rather than add to, any matching history ID.
    const base = new Map(activeEntries.map(e => [e[0], e]));
    for (const [id, entry] of observedEntries) base.set(id, entry);
    for (const [id, entry] of streamEntries) base.set(id, entry);
    const values = core.metrics([...base.values()]);
    // Message classification is retained in CTCore for a future separate utility.
    const hasRatio = target > 0;
    const percentage = hasRatio ? 100 * values.tokens / target : NaN;
    const displayed = hasRatio ? Math.max(0, percentage) : 0;
    const pctLabel = !hasRatio ? 'N/A' : !Number.isFinite(displayed) ? '∞%' :
      `${new Intl.NumberFormat('en-US', {minimumFractionDigits:1,maximumFractionDigits:1}).format(displayed)}%`;
    const noData = values.records === 0 && !complete;
    ui.panel.dataset.phase = initialDiscovery && !lastError ? 'loading' : 'ready';
    const show = flags || {};
    ui.used.textContent = num(values.tokens);
    if (!editingTarget) ui.target.textContent = num(target);
    const showUsed = show.tokens !== false;
    const showLimit = show.limit !== false;
    ui.used.hidden = !showUsed;
    ui.separator.hidden = !(showUsed && showLimit);
    ui.targetWrap.hidden = !showLimit;
    ui.tokensLabel.hidden = !(showUsed || showLimit);
    ui.percent.hidden = show.percent === false;
    ui.percent.textContent = ` (${pctLabel})`;
    ui.numbers.hidden = !(showUsed || showLimit || show.percent !== false);
    const overTarget = hasRatio && !noData && displayed >= 100;
    if (overTarget) host.setAttribute('data-over-target', '');
    else host.removeAttribute('data-over-target');
    ui.status.hidden = show.percent === false;
    ui.fill.style.width = `${Math.min(100, displayed)}%`;
    // Warn yellow at 80%, progressing smoothly to the alert red at 100%.
    if (hasRatio && displayed >= 100) ui.fill.style.backgroundColor = 'var(--ct-alert)';
    else if (hasRatio && displayed >= 80) {
      const step = Math.min(200, Math.max(0, Math.floor((displayed - 80) * 10 + 1e-7)));
      const redWeight = step / 2;
      ui.fill.style.backgroundColor = `color-mix(in srgb, var(--ct-warning) ${100 - redWeight}%, var(--ct-alert) ${redWeight}%)`;
    } else ui.fill.style.removeProperty('background-color');
    ui.progress.setAttribute('aria-valuenow', Math.min(100, displayed).toFixed(1));
    const status = overTarget ? ' Your chosen target was exceeded.' : '';
    ui.panel.setAttribute('aria-label', `Context estimate: ${num(values.tokens)} of ${num(target)} tokens (${pctLabel}).${status}`);
  }

    function setConversation(id) {
      if (activeId === id) return;
      removeUI();
      activeId = id;
      if (id && visible) mount();
    }
    function setVisible(next) {
      visible = !!next;
      if (!visible) removeUI();
      else if (activeId) mount();
    }
    function updateTheme() {
      if (!host?.isConnected) return;
      const form = findComposerForm();
      if (form) updateComposerTheme(form);
    }
    function align() {
      const root = findComposerForm()?.querySelector('[data-composer-dark]');
      const surface = root?.parentElement;
      if (host?.isConnected && surface && host.nextElementSibling === surface) alignWithComposer(surface);
    }
    return {setConversation, setVisible, mount, render, updateTheme, align,
      isMounted:() => !!host?.isConnected};
  };
})();