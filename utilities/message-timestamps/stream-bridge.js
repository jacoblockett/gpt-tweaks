/* MAIN-world timestamps: metadata only. Never modify ChatGPT responses. */
(() => {
  "use strict";
  if(window.__gptTweaksTimestampBridge)return;
  window.__gptTweaksTimestampBridge=true;
  const originalFetch=window.fetch.bind(window);
  const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
  const publish=(type,payload)=>document.dispatchEvent(new CustomEvent(
    "gpt-tweaks:timestamps:"+type,{detail:JSON.stringify(payload)}));

  function generation(input,init){
    try{
      const raw=typeof input==="string"||input instanceof URL?input:input?.url;
      const url=new URL(raw,location.href);
      if(url.origin!==location.origin||
         !["/backend-api/f/conversation","/backend-api/conversation"].includes(url.pathname)||
         String(init?.method||input?.method||"GET").toUpperCase()!=="POST")
        return null;
      const body=typeof init?.body==="string"?JSON.parse(init.body):null;
      if(!Array.isArray(body?.messages))return null;
      return {conversation:validId(body.conversation_id)?body.conversation_id:null,
        users:body.messages.filter(m=>m?.author?.role==="user"&&validId(m.id))
          .map(m=>m.id),at:Date.now()};
    }catch{return null;}
  }
  // Timestamps only observe outgoing user messages; completion detection
  // belongs to utilities/notifications/stream-bridge.js.
  window.fetch=function(...args){
    const request=generation(args[0],args[1]);
    const result=originalFetch(...args);
    if(request)void result.then(response=>{
      if(!response?.ok)return;
      for(const id of request.users)
        publish("submitted",{id,conversation:request.conversation,at:request.at});
    }).catch(()=>{});
    return result;
  };
})();
