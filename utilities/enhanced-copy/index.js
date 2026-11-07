/* Copy entire chat is activated by the GPT Tweaks header menu.
 * Message Copy buttons remain entirely owned by ChatGPT. */
(() => {
  "use strict";
  if(globalThis.GPTTweaksEnhancedCopy)return;
  const settingsPrefix="gpt-tweaks.copy.";
  const idPattern=/^[a-f0-9-]{36}$/i;
  let enabled=false,loaded=false,invalidated=false,loading=null;
  let options={actions:true,menu:true,slash:true};
  let pending=null,toast=null,toastTimer=null;

  function conversationId(){
    return location.pathname.match(/(?:^|\/)c\/([0-9a-f-]{36})(?:\/|$)/i)?.[1]||null;
  }

  function svgIcon(state){
    const ns="http://www.w3.org/2000/svg";
    const svg=document.createElementNS(ns,"svg");
    svg.setAttribute("width","21");
    svg.setAttribute("height","21");
    svg.setAttribute("viewBox",state==="loading"?"0 0 24 24":"0 0 21 21");
    svg.setAttribute("fill","none");
    svg.setAttribute("aria-hidden","true");
    svg.setAttribute("data-gtg-copy-icon",state);
    const path=(d,attributes={})=>{
      const node=document.createElementNS(ns,"path");
      node.setAttribute("d",d);
      for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);
      svg.append(node);
    };
    if(state==="loading"){
      // ChatGPT's native loading ring: same paths, color and proportions.
      path("M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z",
        {fill:"currentColor",opacity:"0.3"});
      path("M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z",
        {fill:"currentColor"});
    }else if(state==="copied"){
      path("M5.3 10.6L8.9 14.2L16 7.1",
        {stroke:"currentColor","stroke-width":"1.7",
          "stroke-linecap":"round","stroke-linejoin":"round"});
    }else if(state==="copy"){
      path("M7 6.5h7.5a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2ZM5 13H4.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2H12a2 2 0 0 1 2 2v1.5",
        {stroke:"currentColor","stroke-width":"1.5","stroke-linejoin":"round"});
    }else{
      path("M6 6L15 15M15 6L6 15",
        {stroke:"currentColor","stroke-width":"1.7",
          "stroke-linecap":"round"});
    }
    return svg;
  }

  function clearToast(){
    clearTimeout(toastTimer);
    toastTimer=null;
    toast?.remove();
    toast=null;
  }
  function showToast(state,message){
    clearTimeout(toastTimer);
    if(!toast){
      toast=document.createElement("aside");
      toast.id="gtg-copy-toast";
      toast.setAttribute("role","status");
      toast.setAttribute("aria-live","polite");
      const icon=document.createElement("span");
      icon.className="gtg-copy-toast-icon";
      const label=document.createElement("span");
      label.className="gtg-copy-toast-label";
      toast.append(icon,label);
      document.body.append(toast);
    }
    toast.dataset.state=state;
    toast.querySelector(".gtg-copy-toast-icon").replaceChildren(svgIcon(state));
    toast.querySelector(".gtg-copy-toast-label").textContent=message;
    if(state!=="loading"){
      const shown=toast;
      toastTimer=setTimeout(()=>{if(toast===shown)clearToast();},
        state==="copied"?3000:5000);
    }
  }

  function clipboardFallback(text){
    const input=document.createElement("textarea");
    input.value=text;
    input.setAttribute("readonly","");
    input.style.position="fixed";
    input.style.opacity="0";
    document.body.append(input);
    input.select();
    const ok=document.execCommand("copy");
    input.remove();
    if(!ok)throw Error("Clipboard copy was not available");
  }
  async function copyText(text){
    if(navigator.clipboard?.writeText){
      try{await navigator.clipboard.writeText(text);return;}
      catch{ /* Permission may fail: try selection fallback. */ }
    }
    clipboardFallback(text);
  }

  function cancelCopy(){
    if(!pending)return;
    const id=pending.id;
    pending=null;
    document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:cancel",{detail:id}));
    clearToast();
  }
  function startCopy(method="actions"){
    if((method!=="header"&&(!enabled||!options[method]))||pending)return;
    const conversation=conversationId();
    if(!idPattern.test(conversation||"")){
      showToast("error","Couldn't identify this chat.");
      return;
    }
    const request={id:crypto.randomUUID().replaceAll("-",""),conversation};
    pending=request;
    showToast("loading","Loading entire chat history");
    document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:request",{
      detail:JSON.stringify({id:request.id,conversationId:conversation,scope:"all"})
    }));
  }

  async function refresh(){
    if(invalidated)return;
    if(loading)return loading;
    loading=(async()=>{
      try{
        const response=await chrome.runtime.sendMessage({type:"gpt-tweaks:copy:preferences"});
        if(!response?.ok)throw Error(response?.error||"Copy preferences unavailable");
        enabled=response.enabled===true;
        options={actions:response.actions===true,menu:response.menu===true,
          slash:response.slash===true};
        loaded=true;
      }catch(error){
        enabled=false;
        loaded=false;
        if(/Extension context invalidated/i.test(String(error)))invalidated=true;
        else console.warn("[GPT Tweaks] Cannot read copy settings",error);
      }
      if(!enabled)cancelCopy();
    })();
    try{await loading;}finally{loading=null;}
  }
  document.addEventListener("gpt-tweaks:copy:result",async event=>{
    let response;
    try{response=JSON.parse(event.detail);}catch{return;}
    if(!pending||response?.id!==pending.id)return;
    const request=pending;
    if(conversationId()!==request.conversation){cancelCopy();return;}
    if(!response.ok){
      pending=null;
      showToast("error","Couldn't copy entire chat.");
      console.warn("[GPT Tweaks] Entire chat copy failed:",response.error);
      return;
    }
    try{
      await copyText(response.text);
      if(pending!==request)return;
      pending=null;
      showToast("copied","Copied");
    }catch(error){
      if(pending!==request)return;
      pending=null;
      showToast("error","Couldn't copy entire chat.");
      console.warn("[GPT Tweaks] Clipboard write failed:",error);
    }
  });
  function onNavigation(){
    if(pending&&conversationId()!==pending.conversation)cancelCopy();
  }
  window.addEventListener("popstate",onNavigation);
  window.addEventListener("pagehide",cancelCopy);
  if(window.navigation?.addEventListener)
    window.navigation.addEventListener("currententrychange",onNavigation);
  window.addEventListener("focus",()=>{void refresh();});
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden)void refresh();
  });
  chrome.storage?.onChanged?.addListener((changes,area)=>{
    if(area!=="local"||
       !["enabled","actions","menu","slash"].some(method=>changes[settingsPrefix+method]))
      return;
    void refresh();
  });
  globalThis.GPTTweaksEnhancedCopy=Object.freeze({
    isEnabled:async method=>{
      if(method!=="menu"&&method!=="slash")return false;
      if(!loaded)await refresh();
      return enabled&&options[method]&&idPattern.test(conversationId()||"");
    },
    activate:method=>{
      if(method==="menu"||method==="slash"||method==="header")startCopy(method);
    }
  });
  void refresh();
})();