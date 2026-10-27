/* Context Tracker uses the shared GitHub Source plus/slash menu registration. */
(() => {
  "use strict";
  const COMMAND="/status";
  const TITLE="Status";
  const DESCRIPTION="Show or hide the context tracker.";
  function statusIcon(size) {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    for (const [name,value] of Object.entries({
      width:String(size),height:String(size),viewBox:"0 0 24 24",fill:"none",
      stroke:"currentColor","stroke-width":"1.8","stroke-linecap":"round",
      "stroke-linejoin":"round","aria-hidden":"true"
    })) svg.setAttribute(name,value);
    const path=document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d","M4 17V7m5 10v-6m5 6V4m5 13v-9");
    svg.append(path);
    return svg;
  }

  const {isEnabled,activate}=globalThis.GPTTweaksContextStatus;
  globalThis.__gptTweaksMenus.register({
    id:"context-tracker",
    command:COMMAND,
    title:TITLE,
    description:DESCRIPTION,
    icon:statusIcon,
    isEnabled,
    activate
  });
})();
