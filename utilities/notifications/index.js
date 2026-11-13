/* Completion alerts: only when ChatGPT is not the focused page.
 * Completion itself is established by the timestamp stream/render observer. */
(() => {
  "use strict";
  if(globalThis.__gptTweaksNotifications)return;
  globalThis.__gptTweaksNotifications=true;
  const uuid=/^[a-f0-9-]{36}$/i;
  const conversationId=()=>location.pathname.match(
    /(?:^|\/)c\/([a-f0-9-]{36})(?:\/|$)/i)?.[1]||null;

  document.addEventListener("gpt-tweaks:timestamps:completed",event=>{
    let message;
    try{message=JSON.parse(event.detail);}catch{return;}
    if(!uuid.test(message?.id||"")||
       !uuid.test(message?.conversation||"")||
       message.conversation!==conversationId())return;
    // document.hidden alone misses switching to another desktop application.
    if(!document.hidden&&document.hasFocus())return;
    void chrome.runtime.sendMessage({
      type:"gpt-tweaks:notification",action:"show",
      conversation:message.conversation,id:message.id,title:document.title
    }).then(reply=>{
      if(!reply?.ok)console.warn("[GPT Tweaks] Completion notification:",reply?.error);
    }).catch(error=>console.warn("[GPT Tweaks] Completion notification:",error));
  });
})();