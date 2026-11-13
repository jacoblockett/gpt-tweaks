/* Timestamp labels share each native message action row without modifying
 * ChatGPT buttons. Unknown historical completion times are not fabricated. */
(() => {
  "use strict";
  if(globalThis.__gptTweaksTimestamps)return;
  globalThis.__gptTweaksTimestamps=true;
  const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
  const formatter=new Intl.DateTimeFormat(undefined,{
    year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"
  });
  const times=new Map(),requested=new Set(),pendingFinals=new Map(),pendingUsers=new Map();
  let active=null,sequence=0,inflight=false,scheduled=false,finalizing=new Set();

  function conversationId(){
    return location.pathname.match(/(?:^|\/)c\/([a-f0-9-]{36})(?:\/|$)/i)?.[1]||null;
  }
  const message=(action,extra={})=>chrome.runtime.sendMessage({
    type:"gpt-tweaks:timestamps",action,...extra
  });
  function entry(id,role){
    for(const node of document.querySelectorAll("[data-chatgpt-search-message-ids]")){
      const ids=(node.getAttribute("data-chatgpt-search-message-ids")||"").split(/\s+/);
      if(!ids.includes(id)||!node.querySelector('[data-conversation-role="'+role+'"]'))
        continue;
      if(role==="assistant"&&!node.querySelector(
        '[data-chatgpt-selection-message-id="'+id+'"]'))continue;
      const toolbar=node.querySelector(".turn-action-controls");
      if(!toolbar)return null;
      const row=role==="user"?toolbar.closest(".flex-row-reverse"):toolbar;
      if(!row||!node.contains(row))return null;
      return {node,row,toolbar};
    }
    return null;
  }
  function dateLabel(id,role,at){
    const target=entry(id,role);
    if(!target)return;
    if(role==="assistant"&&target.node.closest(
      '[data-talvt-turn-state="complete"]')===null)return;
    let label=target.row.querySelector(":scope > .gtg-message-timestamp");
    if(!label){
      label=document.createElement("time");
      label.className="gtg-message-timestamp";
      if(role==="user")target.row.prepend(label);
      else target.row.append(label);
    }
    const iso=new Date(at).toISOString();
    if(label.dateTime!==iso){
      label.dateTime=iso;
      label.textContent=formatter.format(at);
      label.title=(role==="user"?"Submitted":"Response completed")+
        ": "+new Date(at).toLocaleString();
    }
  }
  function record(id,role,at,save){
    if(!validId(id)||!["user","assistant"].includes(role)||
       !Number.isSafeInteger(at)||at<946684800000)return;
    if(!times.has(id)){
      times.set(id,{role,at});
      if(save&&active)void message("save",{
        conversation:active,id,role,at
      }).catch(error=>console.warn("[GPT Tweaks] Timestamp save failed",error));
    }
    dateLabel(id,role,times.get(id).at);
  }
  function parse(event){
    try{return JSON.parse(event.detail);}catch{return null;}
  }
  document.addEventListener("gpt-tweaks:timestamps:submitted",event=>{
    const item=parse(event);
    if(!validId(item?.id)||!Number.isSafeInteger(item.at))return;
    if(!active||item.conversation&&item.conversation!==active)
      pendingUsers.set(item.id,item);
    else record(item.id,"user",item.at,true);
    schedule();
  });
  document.addEventListener("gpt-tweaks:timestamps:final",event=>{
    const item=parse(event);
    if(!validId(item?.id))return;
    pendingFinals.set(item.id,item);
    schedule();
  });
  document.addEventListener("gpt-tweaks:timestamps:history",event=>{
    const payload=parse(event);
    if(payload?.conversation!==active||payload.seq!==sequence)return;
    inflight=false;
    for(const {id,at} of payload.entries||[])
      if(validId(id)&&Number.isSafeInteger(at))record(id,"user",at,false);
    if(payload.error)console.warn("[GPT Tweaks] Timestamp history lookup",payload.error);
    schedule();
  });
  function syncConversation(){
    const id=conversationId();
    if(id===active)return;
    active=id;times.clear();requested.clear();inflight=false;sequence++;
    if(!id)return;
    const expected=id;
    void message("read",{conversation:id}).then(result=>{
      if(active!==expected||!result?.ok)return;
      for(const [messageId,value] of Object.entries(result.entries||{})){
        if(validId(messageId)&&Array.isArray(value)&&
           ["user","assistant"].includes(value[0])&&
           Number.isSafeInteger(value[1]))
          record(messageId,value[0],value[1],false);
      }
      schedule();
    }).catch(error=>console.warn("[GPT Tweaks] Timestamp read failed",error));
  }
  function timestampUsers(){
    if(!active)return;
    for(const [id,item] of pendingUsers){
      if(item.conversation&&item.conversation!==active)continue;
      if(entry(id,"user")){
        record(id,"user",item.at,true);
        pendingUsers.delete(id);
      }
    }
    if(inflight)return;
    const missing=[];
    for(const node of document.querySelectorAll(
      '[data-chatgpt-search-message-ids]')){
      if(!node.querySelector('[data-conversation-role="user"]'))continue;
      const id=(node.getAttribute("data-chatgpt-search-message-ids")||"").split(/\s+/)[0];
      if(validId(id)&&!times.has(id)&&!requested.has(id)){
        missing.push(id);requested.add(id);
      }
      if(missing.length===100)break;
    }
    if(!missing.length)return;
    inflight=true;
    const seq=++sequence;
    document.dispatchEvent(new CustomEvent("gpt-tweaks:timestamps:lookup",{
      detail:JSON.stringify({conversation:active,seq,ids:missing})
    }));
  }
  function completeAssistant(){
    for(const [id,item] of pendingFinals){
      if(!active||item.conversation&&item.conversation!==active)continue;
      const target=entry(id,"assistant");
      if(!target||!target.node.closest('[data-talvt-turn-state="complete"]')||
         finalizing.has(id))continue;
      finalizing.add(id);
      // The completed turn and its toolbar must survive a subsequent
      // rendering tick before recording the visible completion moment.
      setTimeout(()=>{
        finalizing.delete(id);
        if(!active||item.conversation&&item.conversation!==active)return;
        const current=entry(id,"assistant");
        if(!current||!current.node.closest('[data-talvt-turn-state="complete"]'))
          return;
        record(id,"assistant",Date.now(),true);
        pendingFinals.delete(id);
        schedule();
      },75);
    }
  }
  function render(){
    scheduled=false;
    syncConversation();
    for(const [id,value] of times)dateLabel(id,value.role,value.at);
    timestampUsers();
    completeAssistant();
  }
  function schedule(){
    if(scheduled)return;
    scheduled=true;
    setTimeout(render,0);
  }
  new MutationObserver(schedule).observe(document.documentElement,{
    childList:true,subtree:true,attributes:true,
    attributeFilter:["data-talvt-turn-state","data-chatgpt-search-message-ids"]
  });
  window.addEventListener("popstate",schedule);
  if(window.navigation?.addEventListener)
    window.navigation.addEventListener("currententrychange",schedule);
  schedule();
})();