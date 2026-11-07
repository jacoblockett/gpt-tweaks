/* Share ChatGPT's existing plus/slash menu rendering and keyboard behavior. */
(() => {
  "use strict";
  const {isEnabled,activate}=globalThis.GPTTweaksEnhancedCopy;
  function copyIcon(size){
    const ns="http://www.w3.org/2000/svg";
    // ChatGPT's own Copy message button uses an inline, filled 21px icon.
    const source=document.querySelector(
      'button[aria-label="Copy message"] svg,button[aria-label="Copy"] svg');
    if(source){
      const svg=source.cloneNode(true);
      svg.setAttribute("width",String(size));
      svg.setAttribute("height",String(size));
      svg.classList.remove("icon-xs","icon-md");
      return svg;
    }
    // On an empty conversation, reuse ChatGPT's built-in copy-code sprite.
    const svg=document.createElementNS(ns,"svg");
    for(const [key,value] of Object.entries({
      width:String(size),height:String(size),viewBox:"0 0 20 20",
      "aria-hidden":"true"
    }))svg.setAttribute(key,value);
    const use=document.createElementNS(ns,"use");
    const sprite=document.documentElement.dataset.iconSpriteUrl;
    if(sprite)use.setAttribute("href",sprite+"#codex-icon-square-on-square-light-20");
    use.setAttribute("fill","currentColor");
    svg.append(use);
    return svg;
  }
  globalThis.__gptTweaksMenus.register({
    id:"copy-entire-chat",command:"/copy-entire-chat",title:"Copy entire chat",
    description:"Copy the entire conversation to the clipboard.",
    icon:copyIcon,isEnabled,activate
  });
})();
