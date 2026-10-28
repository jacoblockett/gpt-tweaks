/* Copy Entire Chat belongs to the conversation's native top-right Chat actions menu.
 * Message Copy buttons remain entirely owned by ChatGPT. */
(() => {
  "use strict";
  if(globalThis.GPTTweaksEnhancedCopy)return;
  globalThis.GPTTweaksEnhancedCopy=true;

  const setting="gpt-tweaks.copy.enabled";
  const triggerSelector='[data-app-shell-main-titlebar] button[aria-label="Chat actions"][aria-haspopup="menu"]';
  const idPattern=/^[a-f0-9-]{36}$/i;
  let enabled=false,invalidated=false,pending=null,toast=null,toastTimer=null;
  let menuObserver=null,menuTimer=null;

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
  function startCopy(){
    if(pending)return;
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

  // Native Radix menu content is portaled, not a descendant of the More
  // button. Locate the specific Archive/Delete section only after the
  // top-right conversation menu is opened.
  function menuItem(menu,label){
    return [...menu.querySelectorAll('[role="menuitem"]')].find(item=>
      new RegExp("^"+label+"(?: chat)?(?:\\s|$)","i").test(
        (item.textContent||"").replace(/\s+/g," ").trim()))||null;
  }
  function createAction(archive){
    const item=archive.cloneNode(true);
    item.removeAttribute("id");
    item.removeAttribute("data-state");
    item.removeAttribute("data-disabled");
    item.removeAttribute("aria-disabled");
    item.removeAttribute("aria-keyshortcuts");
    item.setAttribute("role","menuitem");
    item.setAttribute("aria-label","Copy Entire Chat");
    item.setAttribute("data-gtg-copy-entire","");
    item.tabIndex=0;
    for(const child of item.querySelectorAll("[id]"))child.removeAttribute("id");
    let renamed=false;
    const visit=node=>{
      if(node.nodeType===3&&/\bArchive(?: chat)?\b/i.test(node.nodeValue||"")){
        node.nodeValue=node.nodeValue.replace(/\bArchive(?: chat)?\b/i,"Copy Entire Chat");
        renamed=true;
      }else for(const child of node.childNodes)visit(child);
    };
    visit(item);
    if(!renamed)item.textContent="Copy Entire Chat";
    // Archive uses a CSS-masked span, not an SVG. Replace the actual
    // captured menu icon slot so the cloned row never retains Archive's icon.
    const slot=item.querySelector('[data-leading-icon-slot="menu"]');
    if(slot){
      const native=document.querySelector(
        'button[aria-label="Copy"] svg, button[aria-label="Copy message"] svg');
      const icon=native?.cloneNode(true)||svgIcon("copy");
      icon.setAttribute("width","16");
      icon.setAttribute("height","16");
      icon.setAttribute("class","icon-sm shrink-0");
      icon.setAttribute("aria-hidden","true");
      icon.removeAttribute("data-gtg-copy-icon");
      slot.replaceChildren(icon);
    }
    function activate(event){
      event.preventDefault();
      event.stopPropagation();
      // Escape closes ChatGPT's portaled native menu without replacing it.
      item.closest('[role="menu"]')?.dispatchEvent(new KeyboardEvent(
        "keydown",{key:"Escape",code:"Escape",bubbles:true,cancelable:true}));
      startCopy();
    }
    item.addEventListener("click",activate);
    item.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){
        event.stopPropagation();
        activate(event);
      }
    });
    return item;
  }

  function inject(trigger){
    if(!enabled||!trigger.isConnected||
       !idPattern.test(conversationId()||"")||
       trigger.getAttribute("aria-expanded")!=="true")return false;
    // Verified from the captured opened-menu HTML: Chat actions'
    // aria-controls is the id of the portaled Radix menu; the menu's
    // aria-labelledby points back to this precise trigger.
    const menuId=trigger.getAttribute("aria-controls");
    const menu=menuId?document.getElementById(menuId):null;
    if(!menu||menu.getAttribute("role")!=="menu"||
       !menu.hasAttribute("data-radix-menu-content")||
       menu.getAttribute("data-state")!=="open"||
       menu.getAttribute("aria-labelledby")!==trigger.id)return false;
    const archive=menuItem(menu,"Archive");
    const remove=menuItem(menu,"Delete");
    if(!archive||!remove||archive.parentElement!==menu||
       remove.parentElement!==menu)return false;
    if(!menu.querySelector("[data-gtg-copy-entire]"))
      menu.insertBefore(createAction(archive),archive);
    return true;
  }
  function stopMenuWatch(){
    menuObserver?.disconnect();
    menuObserver=null;
    clearTimeout(menuTimer);
    menuTimer=null;
  }
  function watchMenu(trigger){
    stopMenuWatch();
    if(!enabled)return;
    menuObserver=new MutationObserver(()=>{
      if(inject(trigger))stopMenuWatch();
    });
    menuObserver.observe(document.body,{childList:true,subtree:true,attributes:true,
      attributeFilter:["aria-expanded"]});
    if(inject(trigger)){stopMenuWatch();return;}
    // A closed or unrelated menu must not leave a permanent DOM observer.
    menuTimer=setTimeout(stopMenuWatch,2000);
  }
  function onMenuTrigger(event){
    const trigger=event.target?.closest?.(triggerSelector);
    if(!trigger)return;
    if(event.type==="keydown"&&!["Enter"," ","ArrowDown"].includes(event.key))
      return;
    watchMenu(trigger);
  }

  async function refresh(){
    if(invalidated)return;
    try{
      const response=await chrome.runtime.sendMessage({type:"gpt-tweaks:copy:preferences"});
      if(!response?.ok)throw Error(response?.error||"Enhanced Copy preferences unavailable");
      enabled=response.enabled===true;
    }catch(error){
      enabled=false;
      if(/Extension context invalidated/i.test(String(error)))invalidated=true;
      else console.warn("[GPT Tweaks] Cannot read copy settings",error);
    }
    if(!enabled){stopMenuWatch();cancelCopy();}
  }
  document.addEventListener("pointerdown",onMenuTrigger,true);
  document.addEventListener("click",onMenuTrigger,true);
  document.addEventListener("keydown",onMenuTrigger,true);
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
    stopMenuWatch();
    if(pending&&conversationId()!==pending.conversation)cancelCopy();
  }
  window.addEventListener("popstate",onNavigation);
  window.addEventListener("pagehide",()=>{stopMenuWatch();cancelCopy();});
  if(window.navigation?.addEventListener)
    window.navigation.addEventListener("currententrychange",onNavigation);
  window.addEventListener("focus",()=>{void refresh();});
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden)void refresh();
  });
  chrome.storage?.onChanged?.addListener((changes,area)=>{
    if(area==="local"&&changes[setting]){
      enabled=changes[setting].newValue!==false&&changes[setting].newValue!=="false";
      if(!enabled){stopMenuWatch();cancelCopy();}
    }
  });
  void refresh();
})();