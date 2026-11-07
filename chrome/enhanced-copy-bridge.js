"use strict";

// Only the Copy Chat feature enable setting crosses the trusted-worker boundary.
(() => {
  const prefix="gpt-tweaks.copy.";
  const keys=[prefix+"enabled"];
  function authorized(sender){
    if(sender?.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id))return false;
    try{return new URL(sender.url).origin==="https://chatgpt.com";}catch{return false;}
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.type!=="gpt-tweaks:copy:preferences")return false;
    if(!authorized(sender)){
      reply({ok:false,error:"Unauthorized enhanced-copy request"});
      return false;
    }
    chrome.storage.local.get(keys).then(saved=>{
      const allowed=key=>saved[key]!==false&&saved[key]!=="false";
      reply({ok:true,enabled:allowed(keys[0])});
    },error=>reply({ok:false,error:String(error)}));
    return true;
  });
})();
