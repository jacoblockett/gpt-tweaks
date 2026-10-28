"use strict";

// Only nonsecret Copy entire chat menu preferences cross the trusted-worker boundary.
(() => {
  const prefix="gpt-tweaks.copy.";
  const keys=["enabled","actions","menu","slash"].map(name=>prefix+name);
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
      reply({ok:true,enabled:allowed(keys[0]),actions:allowed(keys[1]),
        menu:allowed(keys[2]),slash:allowed(keys[3])});
    },error=>reply({ok:false,error:String(error)}));
    return true;
  });
})();
