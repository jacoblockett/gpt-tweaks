(() => {
  "use strict";
  // Extend ChatGPT's existing tooltip, never create a second popup.
  // The shortcut styling and content come from the captured native
  // responsive New chat tooltip.
  const shortcutClass="inline-flex !border-0 !font-sans !shadow-none h-4.5 min-w-4 items-center justify-center rounded-lg !bg-[var(--color-background-tooltip-shortcut)] !px-1.5 !py-0 !text-sm !leading-4.5 !text-[var(--color-text-tooltip-shortcut)] -me-1.75";
  function augment() {
    const buttons=document.querySelectorAll('#app-shell-sidebar button[aria-label="New chat"][aria-describedby]');
    for(const button of buttons){
      for(const id of (button.getAttribute("aria-describedby")||"").split(/\s+/)){
        const tooltip=id&&document.getElementById(id);
        if(!tooltip||tooltip.getAttribute("role")!=="tooltip"||
           tooltip.querySelector("kbd")||tooltip.textContent.trim()!=="New chat")continue;
        // Only match the observed native structure; avoid guessing when
        // ChatGPT renders a materially different tooltip.
        const row=tooltip.firstElementChild;
        if(!row||row.tagName!=="DIV"||row.textContent.trim()!=="New chat")continue;
        row.classList.add("flex","gap-2","items-center");
        const kbd=document.createElement("kbd");
        kbd.className=shortcutClass;
        kbd.textContent="Ctrl+Shift+O";
        row.append(kbd);
      }
    }
  }
  const observer=new MutationObserver(augment);
  function start() {
    observer.observe(document.documentElement,{
      subtree:true,childList:true,attributes:true,attributeFilter:["aria-describedby"]
    });
    augment();
  }
  if(document.documentElement)start();
  else document.addEventListener("DOMContentLoaded",start,{once:true});
})();
