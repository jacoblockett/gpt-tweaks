/* Shared simple select: native select state with the same keyboard/menu UI in
   extension settings and the GitHub repository picker. */
(() => {
  'use strict';
  globalThis.GPTTweaksSelect = (select, trigger, list, {beforeOpen, bindTrigger = true} = {}) => {
    const label = trigger.querySelector('span');
    const options = () => [...select.options];
    function sync() {
      label.textContent = select.selectedOptions?.[0]?.textContent || options()[0]?.textContent || '';
      trigger.disabled = select.disabled || options().length === 0;
    }
    function close() {
      list.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
    function choose(choice) {
      const changed = select.value !== choice.value;
      select.value = choice.value;
      close(); sync();
      if (changed) select.dispatchEvent(new Event('change', {bubbles:true}));
      trigger.focus();
    }
    function open() {
      if (select.disabled || !options().length) return;
      beforeOpen?.();
      list.replaceChildren();
      for (const choice of options()) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'gt-select-option';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(choice.value === select.value));
        row.textContent = choice.textContent;
        row.title = choice.textContent;
        row.addEventListener('click', () => choose(choice));
        list.append(row);
      }
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      const rows = [...list.querySelectorAll('[role="option"]')];
      (rows.find(row => row.getAttribute('aria-selected') === 'true') || rows[0])?.focus();
      list.onkeydown = event => {
        if (event.key === 'Escape') {
          event.preventDefault(); close(); trigger.focus(); return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          const row = document.activeElement;
          if (rows.includes(row)) { event.preventDefault(); row.click(); }
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = rows.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        rows[next]?.focus();
      };
    }
    function toggle() { if (list.hidden) open(); else close(); }
    if (bindTrigger) {
      trigger.addEventListener('click', toggle);
      trigger.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); open();
        }
      });
      document.addEventListener('pointerdown', event => {
        if (!trigger.parentElement?.contains(event.target)) close();
      });
    }
    // Keep the hidden native control as the single authoritative selection.
    select.addEventListener('change', sync);
    sync();
    return {select, open, close, toggle, sync};
  };
})();