"use strict";
/* Global, persistent request budget for extension-initiated history fetches.
 * Native ChatGPT requests are NOT delayed, intercepted or counted. */
(() => {
  const key="gpt-tweaks.history.guard.v1";
  const minGap=30000, hourLimit=8, dayLimit=25;
  const hourMs=3600000, dayMs=86400000, cooldownMs=3600000;
  const validSender=sender=>{
    if(sender?.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id))return false;
    try{return new URL(sender.url).origin==="https://chatgpt.com";}
    catch{return false;}
  };
  let writes=Promise.resolve();
  async function act(message) {
    const now=Date.now();
    const stored=(await chrome.storage.local.get(key))[key]||{};
    const state={
      hourStart:Number.isFinite(stored.hourStart)?stored.hourStart:now,
      dayStart:Number.isFinite(stored.dayStart)?stored.dayStart:now,
      hourCount:Number.isSafeInteger(stored.hourCount)?stored.hourCount:0,
      dayCount:Number.isSafeInteger(stored.dayCount)?stored.dayCount:0,
      lastAt:Number.isFinite(stored.lastAt)?stored.lastAt:0,
      blockedUntil:Number.isFinite(stored.blockedUntil)?stored.blockedUntil:0,
      lease:stored.lease&&typeof stored.lease==="object"?stored.lease:null
    };
    if(now-state.hourStart>=hourMs||now<state.hourStart){
      state.hourStart=now;state.hourCount=0;
    }
    if(now-state.dayStart>=dayMs||now<state.dayStart){
      state.dayStart=now;state.dayCount=0;
    }
    if(state.lease?.expires<=now)state.lease=null;
    let response;
    if(message.action==="throttle"){
      state.blockedUntil=Math.max(state.blockedUntil,now+cooldownMs);
      state.lease=null;
      response={ok:true,blockedUntil:state.blockedUntil};
    }else if(message.action==="acquire"){
      const next=Math.max(state.blockedUntil,
        state.lastAt+minGap,
        state.lease?state.lease.expires:0,
        state.hourCount>=hourLimit?state.hourStart+hourMs:0,
        state.dayCount>=dayLimit?state.dayStart+dayMs:0);
      if(next>now){
        response={ok:false,error:"Extension history requests are paused by the shared safety limit",retryAt:next};
      }else{
        const token=crypto.randomUUID();
        state.lease={token,expires:now+120000};
        state.lastAt=now;state.hourCount++;state.dayCount++;
        response={ok:true,token};
      }
    }else if(message.action==="settle"){
      if(state.lease?.token!==message.token){
        return {ok:false,error:"History request lease expired"};
      }
      state.lease=null;
      if(message.status===429)
        state.blockedUntil=Math.max(state.blockedUntil,now+cooldownMs);
      response={ok:true};
    }else return {ok:false,error:"Unknown history guard action"};
    await chrome.storage.local.set({[key]:state});
    return response;
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type!=="gpt-tweaks:history:guard")return false;
    if(!validSender(sender)||
       !["acquire","settle","throttle"].includes(message.action)){
      respond({ok:false,error:"Unauthorized history guard request"});
      return false;
    }
    if(message.action==="settle"&&
       (typeof message.token!=="string"||message.token.length>100)){
      respond({ok:false,error:"Invalid request lease"});return false;
    }
    const operation=writes=writes.catch(()=>{}).then(()=>act(message));
    operation.then(respond,error=>respond({ok:false,error:String(error)}));
    return true;
  });
})();