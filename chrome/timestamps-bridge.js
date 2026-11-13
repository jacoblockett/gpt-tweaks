"use strict";
(() => {
  const prefix="gpt-tweaks.timestamps.conversation.";
  const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
  const authorized=sender=>{
    if(sender?.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id))return false;
    try{return new URL(sender.url).origin==="https://chatgpt.com";}catch{return false;}
  };
  // Serialize writes so concurrent user/assistant completions cannot erase
  // one another by reading the same previous storage snapshot.
  let writes=Promise.resolve();
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.type!=="gpt-tweaks:timestamps"||!["read","save"].includes(message.action))
      return false;
    if(!authorized(sender)||!validId(message.conversation)){
      reply({ok:false,error:"Unauthorized timestamp request"});return false;
    }
    const run=async()=>{
      const key=prefix+message.conversation;
      const stored=(await chrome.storage.local.get(key))[key]||{};
      if(message.action==="read")return {ok:true,entries:stored};
      if(!validId(message.id)||!["user","assistant"].includes(message.role)||
         !Number.isSafeInteger(message.at)||message.at<946684800000||
         Math.abs(Date.now()-message.at)>120000)
        throw Error("Invalid timestamp");
      // A message ID has exactly one event time. Do not move it on rerender.
      if(!Object.hasOwn(stored,message.id)){
        stored[message.id]=[message.role,message.at];
        const ids=Object.keys(stored);
        for(const old of ids.slice(0,Math.max(0,ids.length-1000)))delete stored[old];
        await chrome.storage.local.set({[key]:stored});
      }
      return {ok:true};
    };
    const operation=message.action==="save"?
      (writes=writes.catch(()=>{}).then(run)):run();
    operation.then(reply,error=>reply({ok:false,error:String(error)}));
    return true;
  });
})();