/* Show the token estimate in the center of the existing ChatGPT titlebar. */
(() => {
  'use strict';
  const format = new Intl.NumberFormat('en-US');
  globalThis.GPTTweaksContextIndicator = core => {
    let activeId = null;
    let visible = false;
    let host = null, label = null, loading = null;
    let state = null, scheduled = false;

    function createUI() {
      host = document.createElement('div');
      host.id = 'ct-v1-marker';
      host.className = 'pointer-events-none flex items-center justify-center whitespace-nowrap text-sm text-secondary';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'true');
      loading = document.createElement('span');
      loading.className = 'inline-flex items-center gap-2';
      // ChatGPT's [data-loading-indicator] SVG and motion-safe animation,
      // reproduced from the supplied live conversation HTML.
      const spinner = document.createElement('span');
      spinner.setAttribute('data-loading-indicator', '');
      spinner.className = 'inline-flex h-fit w-fit items-center justify-center leading-none contain-layout contain-paint contain-style motion-safe:animate-spin';
      spinner.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path opacity="0.3" d="M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z" fill="currentColor"></path>' +
        '<path d="M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z" fill="currentColor"></path></svg>';
      loading.append(spinner, document.createTextNode('Loading token estimate'));
      label = document.createElement('span');
      host.append(loading, label);
    }

    function titlebar() {
      return [...document.querySelectorAll('[data-app-shell-main-titlebar="true"]')]
        .find(node => node.getClientRects().length && node.getAttribute('aria-hidden') !== 'true');
    }

    function mount() {
      if (!visible) { host?.remove(); return; }
      const target = titlebar();
      if (!target) { host?.remove(); return; }
      if (!host) createUI();
      if (host.parentElement !== target) target.append(host);
      render();
    }

    function render(next = state) {
      state = next;
      if (!state || !host) return;
      const {activeEntries, observedEntries, streamEntries, complete,
        initialDiscovery, lastError} = state;
      const entries = new Map(activeEntries.map(e => [e[0], e]));
      for (const [id, entry] of observedEntries) entries.set(id, entry);
      for (const [id, entry] of streamEntries) entries.set(id, entry);
      const estimate = core.metrics([...entries.values()]);
      const pending = !!activeId && initialDiscovery && !complete && !lastError;
      const failed = !!activeId && !!lastError && !complete && estimate.records === 0;
      loading.style.display = pending ? '' : 'none';
      label.style.display = pending ? 'none' : '';
      label.textContent = failed ? 'Token estimate unavailable' :
        format.format(estimate.tokens) + ' tokens';
    }

    function scheduleMount() {
      if (scheduled || !visible) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (!host?.isConnected || host.parentElement !== titlebar()) mount();
      });
    }

    new MutationObserver(scheduleMount).observe(document.documentElement, {
      childList:true, subtree:true
    });
    return {
      setConversation(id) { activeId = id; mount(); },
      setVisible(next) { visible = !!next; mount(); },
      mount, render, isMounted:() => !!host?.isConnected
    };
  };
})();
