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
  let enabled=false,menu=null,origin=null,pending=null;
  let toast=null,toastTimer=null,feedbackButton=null,feedbackTimer=null;
  const labels={
    message:"Message copied.",
    before:"Messages up to this point copied.",
    after:"Messages from this point on copied.",
    all:"Entire conversation copied."
  };
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
    if(!enabled)reset();
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
    return {button,role,messageIds,preferredMessageId:selected||null,
      turnKey:turnId,conversationId:currentConversation()};
  }
  function closeMenu(){
    menu?.remove();
    menu=null;origin=null;
  }
  function hideToast(){
    clearTimeout(toastTimer);
    toastTimer=null;
    toast?.remove();
    toast=null;
  }
  function showToast(message,duration){
    hideToast();
    if(!document.body)return;
    const node=document.createElement("aside");
    node.id="gtg-copy-toast";
    node.setAttribute("role","status");
    node.setAttribute("aria-live","polite");
    const content=document.createElement("span");
    content.textContent=message;
    const dismiss=document.createElement("button");
    dismiss.type="button";
    dismiss.setAttribute("aria-label","Dismiss notification");
    dismiss.textContent="×";
    dismiss.addEventListener("click",()=>{if(toast===node)hideToast();});
    node.append(content,dismiss);
    document.body.append(node);
    toast=node;
    toastTimer=setTimeout(()=>{if(toast===node)hideToast();},duration);
  }
  function feedback(button,state){
    if(!button)return;
    if(state)button.dataset.gtgCopyState=state;
    else delete button.dataset.gtgCopyState;
    const controls=button.closest(".turn-action-controls");
    const wrapper=controls?.parentElement;
    if(wrapper){
      if(state)wrapper.dataset.gtgCopyFeedbackVisible="true";
      else delete wrapper.dataset.gtgCopyFeedbackVisible;
    }
  }
  function clearFeedback(){
    clearTimeout(feedbackTimer);
    feedbackTimer=null;
    if(feedbackButton)feedback(feedbackButton,null);
    feedbackButton=null;
  }
  function cancelPending(){
    if(!pending)return;
    const request=pending;
    pending=null;
    clearTimeout(request.loadingTimer);
    clearTimeout(request.timeout);
    document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:cancel",{detail:request.id}));
    feedback(request.button,null);
  }
  function reset(){
    closeMenu();
    cancelPending();
    clearFeedback();
    hideToast();
  }
  function finishCopy(button,scope){
    clearFeedback();
    feedbackButton=button;
    feedback(button,"copied");
    showToast(labels[scope],3000);
    feedbackTimer=setTimeout(()=>{if(feedbackButton===button)clearFeedback();},3000);
  }
  function failCopy(reason,scope,button){
    console.warn("[GPT Tweaks] Cannot copy conversation:",reason);
    feedback(button,null);
    const subject=scope==="all"?"the entire conversation":
      scope==="before"?"messages up to this point":"messages from this point on";
    showToast("Couldn't copy "+subject+". Please try again.",5000);
  }
  function showLoading(request){
    if(!pending||pending!==request||request.notified)return;
    request.notified=true;
    showToast("Loading more of this conversation. Please wait a moment.",5000);
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
    if(!info.conversationId){
      closeMenu();
      failCopy("Cannot identify conversation URL",scope,info.button);
      return;
    }
    if(scope!=="all"&&!info.messageIds.length&&!info.turnKey){
      closeMenu();
      failCopy("Cannot identify selected message",scope,info.button);
      return;
    }
    closeMenu();
    clearFeedback();
    const id=crypto.randomUUID().replaceAll("-","");
    const request={id,scope,button:info.button,notified:false,
      loadingTimer:null,timeout:null};
    pending=request;
    feedback(request.button,"loading");
    // Fast single-page requests skip the toast. Paginated scans announce as
    // soon as a second page becomes necessary, even before this delay.
    request.loadingTimer=setTimeout(()=>showLoading(request),700);
    request.timeout=setTimeout(()=>{
      if(pending!==request)return;
      cancelPending();
      hideToast();
      failCopy("Timed out loading conversation history",scope,request.button);
    },120000);
    document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:request",{
      detail:JSON.stringify({id,conversationId:info.conversationId,
        messageIds:info.messageIds,preferredMessageId:info.preferredMessageId,
        turnKey:info.turnKey,role:info.role,scope})
    }));
  }
  function open(info){
    closeMenu();
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
          closeMenu();
          if(trigger?.isConnected){
            bypass.add(trigger);
            trigger.click();
            finishCopy(trigger,scope);
          }else failCopy("Copy button no longer exists",scope,trigger);
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
    const clicked=event.target?.closest?.(copySelector);
    if(pending&&clicked){
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if(menu?.contains(event.target))return;
    const button=event.target?.closest?.(copySelector);
    if(button&&bypass.has(button)){bypass.delete(button);return;}
    const info=target(button);
    if(info){
      event.preventDefault();
      event.stopImmediatePropagation();
      open(info);
    }else if(menu)closeMenu();
  },true);
  document.addEventListener("keydown",event=>{
    if(!menu)return;
    if(event.key==="Escape"){event.preventDefault();const button=origin?.button;closeMenu();button?.focus();return;}
    if(!["ArrowUp","ArrowDown","Home","End"].includes(event.key))return;
    const items=[...menu.querySelectorAll('[role="menuitem"]')];
    const current=items.indexOf(document.activeElement);
    const index=event.key==="Home"?0:event.key==="End"?items.length-1:
      (current+(event.key==="ArrowDown"?1:-1)+items.length)%items.length;
    event.preventDefault();
    items[index]?.focus();
  },true);
  document.addEventListener("gpt-tweaks:copy:progress",event=>{
    if(pending?.id===event.detail)showLoading(pending);
  });
  document.addEventListener("gpt-tweaks:copy:result",async event=>{
    let packet;
    try{packet=JSON.parse(event.detail);}catch{return;}
    if(!pending||packet?.id!==pending.id)return;
    const request=pending;
    clearTimeout(request.loadingTimer);
    if(!packet.ok){
      pending=null;
      clearTimeout(request.timeout);
      hideToast();
      failCopy(packet.error,request.scope,request.button);
      return;
    }
    try{
      await copyText(packet.text);
      if(pending!==request)return;
      pending=null;
      clearTimeout(request.timeout);
      hideToast();
      finishCopy(request.button,request.scope);
    }catch(error){
      if(pending!==request)return;
      pending=null;
      clearTimeout(request.timeout);
      hideToast();
      failCopy(error,request.scope,request.button);
    }
  });
  window.addEventListener("popstate",reset);
  window.addEventListener("pagehide",reset);
  window.addEventListener("resize",closeMenu);
  document.addEventListener("scroll",event=>{
    if(menu&&!menu.contains(event.target))closeMenu();
  },true);
  window.addEventListener("focus",()=>{void refresh();});
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden)void refresh();
  });
  chrome.storage?.onChanged?.addListener((changes,area)=>{
    if(area==="local"&&changes[setting]){
      enabled=changes[setting].newValue!==false&&changes[setting].newValue!=="false";
      if(!enabled)reset();
    }
  });
  void refresh();
})();
