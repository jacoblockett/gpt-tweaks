/* User-message timestamps only. Assistant completions belong to notifications. */
(() => {
  "use strict";
  if(globalThis.__gptTweaksTimestamps)return;
  globalThis.__gptTweaksTimestamps=true;
  const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
  const formatter=new Intl.DateTimeFormat(undefined,{
    year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"
  });
  const times=new Map(),pendingUsers=new Map();
  let active=null,scheduled=false;

  function conversationId(){
    return location.pathname.match(/(?:^|\/)c\/([a-f0-9-]{36})(?:\/|$)/i)?.[1]||null;
  }
  const message=(action,extra={})=>chrome.runtime.sendMessage({
    type:"gpt-tweaks:timestamps",action,...extra
  });
  // In the supplied HTML, the user's role heading is a sibling of its
  // message-ID container. The assistant's role heading is its child.
  function roleOf(node){
    const header=node.querySelector(':scope > h4[data-conversation-role]')||
      node.parentElement?.querySelector(':scope > h4[data-conversation-role]');
    const role=header?.getAttribute("data-conversation-role");
    return role==="user"||role==="assistant"?role:null;
  }
  function entry(id,role,knownNode=null){
    for(const node of knownNode?[knownNode]:
      document.querySelectorAll("[data-chatgpt-search-message-ids]")){
      const ids=(node.getAttribute("data-chatgpt-search-message-ids")||"").split(/\s+/);
      if(!ids.includes(id)||roleOf(node)!==role)
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
  function dateLabel(id,at,knownNode=null){
    const target=entry(id,"user",knownNode);
    if(!target)return;
    // The native action controls live inside ChatGPT's hover-hidden wrapper.
    // Reparent any label installed by an older version instead of leaving
    // it outside that wrapper where it remains visible at rest.
    let label=target.node.querySelector(".gtg-message-timestamp");
    if(!label){
      label=document.createElement("time");
      label.className="gtg-message-timestamp";
    }
    if(label.parentElement!==target.toolbar)target.toolbar.append(label);
    const iso=new Date(at).toISOString();
    if(label.dateTime!==iso){
      label.dateTime=iso;
      label.textContent=formatter.format(at);
      label.title="Submitted: "+new Date(at).toLocaleString();
    }
  }
  function record(id,at,save){
    if(!validId(id)||!Number.isSafeInteger(at)||at<946684800000)return;
    if(!times.has(id)){
      times.set(id,at);
      if(save&&active)void message("save",{
        conversation:active,id,role:"user",at
      }).catch(error=>console.warn("[GPT Tweaks] Timestamp save failed",error));
    }
    dateLabel(id,times.get(id));
  }
  function parse(event){
    try{return JSON.parse(event.detail);}catch{return null;}
  }
  document.addEventListener("gpt-tweaks:timestamps:submitted",event=>{
    const item=parse(event);
    if(!validId(item?.id)||!Number.isSafeInteger(item.at))return;
    if(!active||item.conversation&&item.conversation!==active)
      pendingUsers.set(item.id,item);
    else record(item.id,item.at,true);
    schedule();
  });
  // The token estimator observes native ChatGPT history responses once.
  // Reuse its timestamp metadata instead of issuing any history requests.
  document.addEventListener("ct-v1-history",event=>{
    const payload=parse(event);
    if(payload?.type!=="native"||payload.id!==active||!active)return;
    const entries=[];
    for(const pair of payload.response?.userTimes||[]){
      if(!Array.isArray(pair)||!validId(pair[0])||
         !Number.isSafeInteger(pair[1])||pair[1]<946684800000)continue;
      const unseen=!times.has(pair[0]);
      record(pair[0],pair[1],false);
      if(unseen)entries.push(pair);
    }
    for(let i=0;i<entries.length;i+=200){
      void message("saveBatch",{
        conversation:active,entries:entries.slice(i,i+200)
      }).then(reply=>{
        if(!reply?.ok)console.warn("[GPT Tweaks] Timestamp cache save",reply?.error);
      }).catch(error=>console.warn("[GPT Tweaks] Timestamp cache save",error));
    }
    schedule();
  });
  function syncConversation(){
    const id=conversationId();
    if(id===active)return;
    active=id;times.clear();
    if(!id)return;
    const expected=id;
    void message("read",{conversation:id}).then(result=>{
      if(active!==expected||!result?.ok)return;
      for(const [messageId,value] of Object.entries(result.entries||{})){
        if(validId(messageId)&&Array.isArray(value)&&
           value[0]==="user"&&Number.isSafeInteger(value[1]))
          record(messageId,value[1],false);
      }
      schedule();
      document.dispatchEvent(new Event("ct-v1-bridge-ready"));
    }).catch(error=>console.warn("[GPT Tweaks] Timestamp read failed",error));
  }
  function timestampUsers(){
    if(!active)return;
    for(const [id,item] of pendingUsers){
      if(item.conversation&&item.conversation!==active)continue;
      if(entry(id,"user")){
        record(id,item.at,true);
        pendingUsers.delete(id);
      }
    }
  }
  function render(){
    scheduled=false;
    syncConversation();
    // One DOM walk per rendering tick, including on long conversations.
    // All stored off-screen messages render when ChatGPT virtualizes them in.
    for(const node of document.querySelectorAll("[data-chatgpt-search-message-ids]")){
      const role=roleOf(node);
      if(role!=="user"){
        // Remove labels from previous extension versions, if present.
        node.querySelectorAll(".gtg-message-timestamp").forEach(label=>label.remove());
        continue;
      }
      for(const id of (node.getAttribute("data-chatgpt-search-message-ids")||"").split(/\s+/)){
        const at=times.get(id);
        if(at){dateLabel(id,at,node);break;}
      }
    }
    timestampUsers();
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