/* Token Estimator uses the same shared plus/slash menu registration as GitHub Source. */
(() => {
  "use strict";
  const COMMAND="/tokens";
  const TITLE="Tokens";
  const DESCRIPTION="Show or hide the token estimator.";
  function tokensIcon(size) {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    for (const [name,value] of Object.entries({
      width:String(size),height:String(size),viewBox:"0 0 24 24",fill:"none",
      stroke:"currentColor","stroke-width":"2","stroke-linecap":"round",
      "stroke-linejoin":"round","aria-hidden":"true"
    })) svg.setAttribute(name,value);
    // Lucide Gauge icon: https://lucide.dev/icons/gauge
    for(const d of ["m12 14 4-4","M3.34 19a10 10 0 1 1 17.32 0"]){
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",d);
      svg.append(path);
    }
    return svg;
  }

  const {isEnabled,activate}=globalThis.GPTTweaksContextTokens;
  globalThis.__gptTweaksMenus.register({
    id:"context-tracker",
    command:COMMAND,
    title:TITLE,
    description:DESCRIPTION,
    icon:tokensIcon,
    isEnabled,
    activate
  });
})();
