"use strict";

// Only the nonsecret Enhanced Copy toggle crosses the trusted-worker boundary.
(() => {
  const key="gpt-tweaks.copy.enabled";
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
    chrome.storage.local.get(key).then(saved=>
      reply({ok:true,enabled:saved[key]!==false&&saved[key]!=="false"}),
      error=>reply({ok:false,error:String(error)}));
    return true;
  });
})();
