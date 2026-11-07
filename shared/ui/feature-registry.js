/* Shared feature icon/action registry and composer lookup for the GPT Tweaks header dropdown. */
(() => {
  "use strict";
  if(globalThis.__gptTweaksMenus)return;
  const utilities=new Map();
  function register(config){
    if(!config||!/^[a-z0-9-]+$/.test(config.id||"")||
       typeof config.icon!=="function"||typeof config.activate!=="function")
      throw Error("Invalid GPT Tweaks utility registration.");
    if(utilities.has(config.id))throw Error("Duplicate GPT Tweaks utility: "+config.id);
    utilities.set(config.id,config);
  }
  function composer(){
    return document.querySelector('[data-composer-input] [contenteditable="true"][role="textbox"]')||
      document.querySelector('[data-testid="composer-text-input"]')||
      document.querySelector("#prompt-textarea")||
      document.querySelector('[contenteditable="true"][role="textbox"]');
  }
  globalThis.__gptTweaksMenus=Object.freeze({
    register,composer,
    icon:(id,size)=>utilities.get(id)?.icon(size),
    activate:(id,method)=>utilities.get(id)?.activate(method)
  });
})();
