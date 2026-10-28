/* Share ChatGPT's existing plus/slash menu rendering and keyboard behavior. */
(() => {
  "use strict";
  const {isEnabled,activate}=globalThis.GPTTweaksEnhancedCopy;
  function copyIcon(size){
    const ns="http://www.w3.org/2000/svg";
    const svg=document.createElementNS(ns,"svg");
    for(const [name,value] of Object.entries({
      width:String(size),height:String(size),viewBox:"0 0 21 21",fill:"none",
      "stroke":"currentColor","stroke-width":"1.5",
      "stroke-linejoin":"round","aria-hidden":"true"
    }))svg.setAttribute(name,value);
    const path=document.createElementNS(ns,"path");
    path.setAttribute("d",
      "M7 6.5h7.5a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2ZM5 13H4.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2H12a2 2 0 0 1 2 2v1.5");
    svg.append(path);
    return svg;
  }
  globalThis.__gptTweaksMenus.register({
    id:"copy-entire-chat",command:"/copy-entire-chat",title:"Copy entire chat",
    description:"Copy the entire conversation to the clipboard.",
    icon:copyIcon,isEnabled,activate
  });
})();
