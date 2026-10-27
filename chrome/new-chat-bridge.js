"use strict";

// Privileged tab/window creation and new-chat preferences stay in the worker.
(() => {
  const prefix="gpt-tweaks.new-chat.";
  const keys=["enabled","middle-click","slash","destination"].map(name=>prefix+name);
  function allowedSender(sender) {
    if(sender?.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id))return false;
    try{return new URL(sender.url).origin==="https://chatgpt.com";}catch{return false;}
  }
  async function preferences() {
    const saved=await chrome.storage.local.get(keys);
    return {
      enabled:saved[keys[0]]!=="false",
      middle:saved[keys[1]]!=="false",
      slash:saved[keys[2]]!=="false",
      destination:saved[keys[3]]==="window"?"window":"tab"
    };
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type!=="gpt-tweaks:new-chat:preferences"&&
       message?.type!=="gpt-tweaks:new-chat:open")return false;
    if(!allowedSender(sender)){
      respond({ok:false,error:"Unauthorized new-chat request"});
      return false;
    }
    (async()=>{
      const prefs=await preferences();
      if(message.type==="gpt-tweaks:new-chat:preferences")
        return {ok:true,data:prefs};
      const method=message.method;
      if(!prefs.enabled||
         !(method==="middle"&&prefs.middle||method==="slash"&&prefs.slash))
        return {ok:false,error:"New-chat shortcut disabled"};
      const url="https://chatgpt.com/";
      if(prefs.destination==="window")
        await chrome.windows.create({url,focused:method==="slash"});
      else
        await chrome.tabs.create({url,active:method==="slash"});
      return {ok:true};
    })().then(respond,error=>respond({ok:false,error:String(error)}));
    return true;
  });
})();
