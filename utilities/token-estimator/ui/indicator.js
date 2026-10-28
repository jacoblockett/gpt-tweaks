/* Native-composer appearance and lifecycle for the token estimator. */
(() => {
  'use strict';
  const sheet = `
    :host { display:block; position:relative; z-index:1; box-sizing:border-box;
      align-self:stretch; width:100%; max-width:100%; min-width:0;
      height:60px; flex:none; margin-bottom:0; container-type:inline-size;
      background-color:var(--composer-layout-surface-background, var(--ct-surface-fallback, #1b1b1b));
      -webkit-backdrop-filter:var(--composer-layout-surface-backdrop-filter, none);
      backdrop-filter:var(--composer-layout-surface-backdrop-filter, none);
      border:0; border-radius:var(--ct-corner-radius, 28px) var(--ct-corner-radius, 28px) 0 0;
      --ct-accent:var(--color-background-composer-primary, #7849d1);
      --ct-warning:#eab308;
      --ct-alert:var(--app-color-decoration-deleted, #fa423e);
      color:var(--color-text, #ededed); font:inherit; text-align:left; line-height:normal; }
    *, *::before, *::after { box-sizing:border-box; }
    #tracker { position:relative; display:flex; align-items:center; justify-content:center;
      width:100%; height:60px; border:0; padding:12px 18px;
      background:transparent; color:inherit; }
    .track { display:block; width:100%; min-width:0; height:6px; flex:none; overflow:hidden;
      background:color-mix(in srgb, var(--color-text, #ededed) 15%, transparent);
      border-radius:99px; }
    .track[hidden] { display:none; }
    .metrics { position:absolute; z-index:1; left:50%; top:50%; transform:translate(-50%,-50%);
      max-width:calc(100% - 36px); padding:0 8px; border:0; border-radius:0; box-shadow:none;
      background:var(--composer-layout-surface-background, var(--ct-surface-fallback, #1b1b1b));
      color:inherit; font-family:inherit; font-size:14px; font-weight:400; line-height:19px;
      font-variant-numeric:tabular-nums; text-align:center; white-space:nowrap;
      overflow:hidden; text-overflow:ellipsis; }
    .metrics[hidden] { display:none; }
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
    @container (max-width:370px) { #tracker { padding-inline:11px; }
      .metrics { max-width:calc(100% - 22px); font-size:12px; } }
    @media (prefers-reduced-motion:reduce) { #fill { transition:none; } .spinner { animation:none; } }
  `;
  const num = value => {
    const raw = String(value);
    if (raw.includes('e')) return raw; // Preserve tiny/huge numeric targets.
    const [whole, fraction] = raw.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction === undefined ? grouped : `${grouped}.${fraction}`;
  };

  globalThis.GPTTweaksContextIndicator = core => {
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
      <span class="track" id="progress" role="progressbar" aria-label="Estimated conversation length against custom token target" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="fill"></span></span>
      <span class="metrics" id="metrics"><span id="numbers">0 / 512,000 tokens (0.0%)</span></span>
      <span class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Calculating current session metrics</span>`;
    shadow.append(panel);
    return {rootHost, panel, metrics:shadow.querySelector('#metrics'),
      numbers:shadow.querySelector('#numbers'), progress:shadow.querySelector('#progress'),
      fill:shadow.querySelector('#fill')};
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
    const read = name => styles.map(style => style.getPropertyValue(name).trim()).find(value => value.length > 0);
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
    // The target is presentation-only: disabling it must not stop estimates
    // or change the conversation display's independent visibility setting.
    const show = flags || {};
    const hasRatio = show.targetEnabled !== false && target > 0;
    const percentage = hasRatio ? 100 * values.tokens / target : NaN;
    const displayed = hasRatio ? Math.max(0, percentage) : 0;
    const pctLabel = !hasRatio ? 'N/A' : !Number.isFinite(displayed) ? '∞%' :
      `${new Intl.NumberFormat('en-US', {minimumFractionDigits:1,maximumFractionDigits:1}).format(displayed)}%`;
    const noData = values.records === 0 && !complete;
    ui.panel.dataset.phase = initialDiscovery && !lastError ? 'loading' : 'ready';
    ui.progress.hidden = !hasRatio;
    const showUsed = show.tokens !== false;
    const showLimit = hasRatio && show.limit !== false;
    const showPercent = hasRatio && show.percent !== false;
    const counts = showUsed && showLimit ? `${num(values.tokens)} / ${num(target)}` :
      showUsed ? num(values.tokens) : showLimit ? num(target) : '';
    ui.numbers.textContent = counts ? `${counts} tokens${showPercent ? ` (${pctLabel})` : ''}` :
      showPercent ? pctLabel : '';
    ui.metrics.hidden = !counts && !showPercent;
    const overTarget = hasRatio && !noData && displayed >= 100;
    if (overTarget) host.setAttribute('data-over-target', '');
    else host.removeAttribute('data-over-target');
    ui.fill.style.width = `${Math.min(100, displayed)}%`;
    // Warn yellow at 80%, progressing smoothly to the alert red at 100%.
    if (hasRatio && displayed >= 100) {
      ui.fill.style.setProperty('background-color', 'var(--ct-alert)');
      ui.metrics.style.setProperty('color', 'var(--ct-alert)');
    }
    else if (hasRatio && displayed >= 80) {
      const step = Math.min(200, Math.max(0, Math.floor((displayed - 80) * 10 + 1e-7)));
      const redWeight = step / 2;
      const warningColor = `color-mix(in srgb, var(--ct-warning) ${100 - redWeight}%, var(--ct-alert) ${redWeight}%)`;
      ui.fill.style.setProperty('background-color', warningColor);
      ui.metrics.style.setProperty('color', warningColor);
    } else {
      ui.fill.style.removeProperty('background-color');
      ui.metrics.style.removeProperty('color');
    }
    if (hasRatio)
      ui.progress.setAttribute('aria-valuenow', Math.min(100, displayed).toFixed(1));
    else ui.progress.removeAttribute('aria-valuenow');
    ui.panel.setAttribute('aria-label', hasRatio ?
      `Token estimate: ${num(values.tokens)} of ${num(target)} tokens (${pctLabel}).` :
      `Token estimate: ${num(values.tokens)} tokens.`);
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