/* MAIN-world timestamps: metadata only. Never modify ChatGPT responses. */
(() => {
  "use strict";
  if(window.__gptTweaksTimestampBridge)return;
  window.__gptTweaksTimestampBridge=true;
  const originalFetch=window.fetch.bind(window);
  const history=window.GPTTweaksConversationHistory;
  const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
  const publish=(type,payload)=>document.dispatchEvent(new CustomEvent(
    "gpt-tweaks:timestamps:"+type,{detail:JSON.stringify(payload)}));

  document.addEventListener("gpt-tweaks:timestamps:lookup",async event=>{
    let request;
    try{request=JSON.parse(event.detail);}catch{return;}
    const {conversation,seq,ids}=request||{};
    if(!validId(conversation)||!Number.isSafeInteger(seq)||
       !Array.isArray(ids)||ids.length>100||ids.some(id=>!validId(id)))return;
    const wanted=new Set(ids),found=[];
    if(!wanted.size)return;
    try {
      await history.scan(conversation,{maxPages:500,onPage:page=>{
        for(const message of page.messages){
          if(!wanted.has(message?.id)||message.author?.role!=="user"||
             message.metadata?.is_visually_hidden_from_conversation===true||
             message.metadata?.is_user_system_message===true)continue;
          // create_time is not assumed to be a completion timestamp.
          // Display it only for users, if an actual history response supplies it.
          const seconds=message.create_time;
          if(typeof seconds!=="number"||!Number.isFinite(seconds)||
             seconds<946684800||seconds>Date.now()/1000+300)continue;
          found.push({id:message.id,at:Math.round(seconds*1000)});
          wanted.delete(message.id);
        }
        return wanted.size>0;
      }});
      publish("history",{conversation,seq,entries:found});
    }catch(error){
      publish("history",{conversation,seq,entries:found,error:String(error)});
    }
  });

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
