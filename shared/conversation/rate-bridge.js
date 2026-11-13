/* Isolated content-script gate: page-world history cannot access extension
 * storage directly. Deny requests if the worker is unavailable. */
(() => {
  "use strict";
  if(globalThis.__gptTweaksHistoryRateBridge)return;
  globalThis.__gptTweaksHistoryRateBridge=true;
  const validId=value=>typeof value==="string"&&
    /^[0-9a-f-]{36}$/i.test(value);
  const send=(action,fields={})=>chrome.runtime.sendMessage({
    type:"gpt-tweaks:history:guard",action,...fields
  });

  document.addEventListener("gpt-tweaks:history:permit",event=>{
    let payload;
    try{payload=JSON.parse(event.detail);}catch{return;}
    if(typeof payload?.id!=="string"||
       !/^[0-9a-f-]{36}$/i.test(payload.id)||!validId(payload.conversation))return;
    void send("acquire").then(result=>{
      document.dispatchEvent(new CustomEvent("gpt-tweaks:history:permission",{
        detail:JSON.stringify({id:payload.id,...result})
      }));
    }).catch(error=>{
      document.dispatchEvent(new CustomEvent("gpt-tweaks:history:permission",{
        detail:JSON.stringify({id:payload.id,ok:false,error:String(error)})
      }));
    });
  });
  document.addEventListener("gpt-tweaks:history:settle",event=>{
    let payload;
    try{payload=JSON.parse(event.detail);}catch{return;}
    if(typeof payload?.token!=="string"||payload.token.length>100)return;
    void send("settle",{token:payload.token,status:payload.status}).catch(()=>{});
  });
  document.addEventListener("gpt-tweaks:history:rate-limited",()=>{
    void send("throttle").catch(()=>{});
  });
})();