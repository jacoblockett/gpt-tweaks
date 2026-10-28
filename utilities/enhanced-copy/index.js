(() => {
  "use strict";
  if(globalThis.GPTTweaksEnhancedCopy)return;
  globalThis.GPTTweaksEnhancedCopy=true;
  const setting="gpt-tweaks.copy.enabled";
  const copySelector='button[aria-label="Copy"],button[aria-label="Copy message"]';
  const actions=[
    ["message","Copy this message"],
    ["before","Copy before this message"],
    ["after","Copy after this message"],
    ["all","Copy entire chat history"]
  ];
  let enabled=false,menu=null,origin=null,activeRequest=null;
  const bypass=new WeakSet();

  function currentConversation(){
    return location.pathname.match(/(?:^|\/)c\/([0-9a-f-]{36})(?:\/|$)/i)?.[1]||null;
  }
  let invalidated=false;
  async function refresh(){
    if(invalidated)return;
    try{
      const result=await chrome.runtime.sendMessage({type:"gpt-tweaks:copy:preferences"});
      if(!result?.ok)throw Error(result?.error||"Enhanced copy preferences unavailable");
      enabled=result.enabled===true;
    }catch(error){
      enabled=false;
      if(/Extension context invalidated/i.test(String(error))){
        invalidated=true;
      }else console.warn("[GPT Tweaks] Cannot read enhanced copy settings",error);
    }
    if(!enabled)close();
  }
  function target(button){
    if(!button?.matches(copySelector)||!button.closest(".turn-action-controls"))return null;
    const unit=button.closest("[data-chatgpt-search-unit-key]");
    const key=unit?.getAttribute("data-chatgpt-search-unit-key")||"";
    let role=key.endsWith(":user")?"user":key.endsWith(":assistant")?"assistant":null;
    if(!role){
      if(button.getAttribute("aria-label")==="Copy message")role="user";
      else if(button.getAttribute("aria-label")==="Copy")role="assistant";
    }
    if(!role)return null;
    const unitIds=(unit?.getAttribute("data-chatgpt-search-message-ids")||"")
      .trim().split(/\s+/).filter(Boolean);
    const selected=unit?.querySelector("[data-chatgpt-selection-message-id]")?.
      getAttribute("data-chatgpt-selection-message-id");
    // ChatGPT can list several IDs for an assistant turn (streaming,
    // commentary, final). Let the history reader identify the visible final
    // message rather than guessing which DOM ID is authoritative.
    const turnId=button.closest("[data-turn-key]")?.getAttribute("data-turn-key");
    const messageIds=[...new Set([selected,...unitIds,turnId])]
      .filter(id=>typeof id==="string"&&/^[a-f0-9-]{36}$/i.test(id));
    return {button,role,messageIds,turnKey:turnId,conversationId:currentConversation()};
  }
  function close(){
    if(activeRequest){
      document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:cancel",{detail:activeRequest}));
      activeRequest=null;
    }
    menu?.remove();
    menu=null;origin=null;
  }
  function reportFailure(reason){
    console.warn("[GPT Tweaks] Cannot copy conversation:",reason);
    if(!menu)return;
    const status=menu.querySelector("[data-gtg-copy-status]");
    if(status)status.textContent="Unable to copy complete history. Please try again.";
  }
  function clipboardFallback(text){
    const input=document.createElement("textarea");
    input.value=text;
    input.setAttribute("readonly","");
    input.style.position="fixed";
    input.style.opacity="0";
    document.body.append(input);
    input.select();
    const copied=document.execCommand("copy");
    input.remove();
    if(!copied)throw Error("Clipboard copy was not available");
  }
  async function copyText(text){
    if(navigator.clipboard?.writeText){
      try{await navigator.clipboard.writeText(text);return;}
      catch{ /* Transient clipboard permission: try the selection fallback. */ }
    }
    clipboardFallback(text);
  }
  function copyRange(info,scope){
    if(activeRequest){
      document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:cancel",{detail:activeRequest}));
      activeRequest=null;
    }
    if(!info.conversationId){
      reportFailure("Cannot identify this conversation from the current URL");
      return;
    }
    // Whole-chat copying has no selected-message boundary. ChatGPT's
    // virtualized DOM may not expose a stable ID for the clicked button.
    if(scope!=="all"&&!info.messageIds.length&&!info.turnKey){
      reportFailure("Cannot identify the selected message for this copy range");
      return;
    }
    const id=crypto.randomUUID().replaceAll("-","");
    activeRequest=id;
    const status=menu?.querySelector("[data-gtg-copy-status]");
    if(status)status.textContent="Loading conversation history…";
    document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:request",{
      detail:JSON.stringify({id,conversationId:info.conversationId,
        messageIds:info.messageIds,turnKey:info.turnKey,
        role:info.role,scope})
    }));
  }
  function open(info){
    close();
    origin=info;
    const root=document.createElement("div");
    root.id="gtg-copy-menu";
    root.setAttribute("role","menu");
    root.setAttribute("aria-label","Copy options");
    root.tabIndex=-1;
    for(const [scope,label] of actions){
      const button=document.createElement("button");
      button.type="button";
      button.setAttribute("role","menuitem");
      button.textContent=label;
      button.addEventListener("click",()=>{
        if(scope==="message"){
          const trigger=origin?.button;
          close();
          if(trigger?.isConnected){
            bypass.add(trigger);
            trigger.click();
          }else console.warn("[GPT Tweaks] Copy button no longer exists");

        }else copyRange(origin,scope);
      });
      root.append(button);
    }
    const status=document.createElement("div");
    status.className="gtg-copy-status";
    status.setAttribute("role","status");
    status.dataset.gtgCopyStatus="true";
    root.append(status);
    document.body.append(root);
    const rect=info.button.getBoundingClientRect();
    const width=root.offsetWidth||260,height=root.offsetHeight||185;
    root.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+"px";
    root.style.top=(rect.bottom+height+8<=window.innerHeight?
      rect.bottom+6:Math.max(8,rect.top-height-6))+"px";
    menu=root;
    root.querySelector("button")?.focus();
  }
  document.addEventListener("click",event=>{
    if(!enabled)return;
    if(menu?.contains(event.target))return;
    const button=event.target?.closest?.(copySelector);
    if(button&&bypass.has(button)){bypass.delete(button);return;}
    const info=target(button);
    if(info){
      event.preventDefault();
      event.stopImmediatePropagation();
      open(info);
    }else if(menu)close();
  },true);
  document.addEventListener("keydown",event=>{
    if(!menu)return;
    if(event.key==="Escape"){event.preventDefault();const button=origin?.button;close();button?.focus();return;}
    if(!["ArrowUp","ArrowDown","Home","End"].includes(event.key))return;
    const items=[...menu.querySelectorAll('[role="menuitem"]')];
    const current=items.indexOf(document.activeElement);
    const index=event.key==="Home"?0:event.key==="End"?items.length-1:
      (current+(event.key==="ArrowDown"?1:-1)+items.length)%items.length;
    event.preventDefault();
    items[index]?.focus();
  },true);
  document.addEventListener("gpt-tweaks:copy:result",async event=>{
    let packet;
    try{packet=JSON.parse(event.detail);}catch{return;}
    if(!activeRequest||packet?.id!==activeRequest||!menu)return;
    activeRequest=null;
    if(!packet.ok){reportFailure(packet.error);return;}
    try{await copyText(packet.text);close();}
    catch(error){reportFailure(error);}
  });
  window.addEventListener("popstate",close);
  window.addEventListener("pagehide",close);
  window.addEventListener("resize",close);
  document.addEventListener("scroll",event=>{
    if(menu&&!menu.contains(event.target))close();
  },true);
  window.addEventListener("focus",()=>{void refresh();});
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden)void refresh();
  });
  chrome.storage?.onChanged?.addListener((changes,area)=>{
    if(area==="local"&&changes[setting]){
      enabled=changes[setting].newValue!==false&&changes[setting].newValue!=="false";
      if(!enabled)close();
    }
  });
  void refresh();
})();
