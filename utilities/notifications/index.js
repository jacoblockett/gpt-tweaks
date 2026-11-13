/* Notify when an assistant's final streaming message completes off-focus.
 * No ChatGPT DOM or toolbar dependency. */
(() => {
  "use strict";
  if(globalThis.__gptTweaksNotifications)return;
  globalThis.__gptTweaksNotifications=true;
  const uuid=/^[a-f0-9-]{36}$/i;
  const conversationId=()=>location.pathname.match(
    /(?:^|\/)c\/([a-f0-9-]{36})(?:\/|$)/i)?.[1]||null;

  document.addEventListener("gpt-tweaks:notifications:completed",event=>{
    let message;
    try{message=JSON.parse(event.detail);}catch{return;}
    const current=conversationId();
    // The first reply in a new chat can start with no conversation ID.
    const conversation=uuid.test(message?.conversation||"")?
      message.conversation:current;
    if(!uuid.test(message?.id||"")||!uuid.test(conversation||"")||
       current&&current!==conversation)return;
    if(!document.hidden&&document.hasFocus())return;
    void chrome.runtime.sendMessage({
      type:"gpt-tweaks:notification",action:"show",
      conversation,id:message.id,title:document.title
    }).then(reply=>{
      if(!reply?.ok)console.warn("[GPT Tweaks] Completion notification:",reply?.error);
    }).catch(error=>console.warn("[GPT Tweaks] Completion notification:",error));
  });
})();
