(() => {
  "use strict";
  function handoffIcon(size) {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    for(const [name,value] of Object.entries({
      width:String(size),height:String(size),viewBox:"0 0 24 24",fill:"none",
      stroke:"currentColor","stroke-width":"2","stroke-linecap":"round",
      "stroke-linejoin":"round","aria-hidden":"true"
    }))svg.setAttribute(name,value);
    // Lucide file-output icon.
    for(const d of [
      "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z",
      "M14 2v6h6","M8 13h8","m13 10 3 3-3 3"
    ]){
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",d);
      svg.append(path);
    }
    return svg;
  }
  const {isEnabled,activate}=globalThis.GPTTweaksHandoff;
  globalThis.__gptTweaksMenus.register({
    id:"session-handoff",command:"/handoff",title:"Session Handoff",
    description:"Continue this conversation in a new chat.",
    icon:handoffIcon,isEnabled,activate
  });
})();