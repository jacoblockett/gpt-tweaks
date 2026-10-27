(() => {
  "use strict";
  function newChatIcon(size) {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    for(const [key,value] of Object.entries({
      width:String(size),height:String(size),viewBox:"0 0 24 24",
      fill:"none",stroke:"currentColor","stroke-width":"1.8",
      "stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"
    }))svg.setAttribute(key,value);
    // Lucide square-pen.
    for(const d of ["M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
      "M18.375 2.625a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"]){
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",d);
      svg.append(path);
    }
    return svg;
  }
  const {isEnabled,activate}=globalThis.GPTTweaksNewChat;
  globalThis.__gptTweaksMenus.register({
    id:"new-chat",
    command:"/new-chat",
    title:"New Chat",
    description:"Open a new chat in a tab or window.",
    icon:newChatIcon,
    isEnabled,
    activate
  });
})();
