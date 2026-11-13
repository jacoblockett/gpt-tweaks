"use strict";
(() => {
  const prefix="gpt-tweaks.timestamps.conversation.";
  const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
  const authorized=sender=>{
    if(sender?.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id))return false;
    try{return new URL(sender.url).origin==="https://chatgpt.com";}catch{return false;}
  };
  // Serialize concurrent user submission writes to avoid lost updates.
  let writes=Promise.resolve();
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.type!=="gpt-tweaks:timestamps"||!["read","save","saveBatch"].includes(message.action))
      return false;
    if(!authorized(sender)||!validId(message.conversation)){
      reply({ok:false,error:"Unauthorized timestamp request"});return false;
    }
    const run=async()=>{
      const key=prefix+message.conversation;
      const stored=(await chrome.storage.local.get(key))[key]||{};
      if(message.action==="read")return {ok:true,entries:stored};
      // Server-provided native history timestamps can be old. They must be
      // validated structurally but never treated as a fresh submission.
      const entries=message.action==="saveBatch"?message.entries:
        [[message.id,message.at]];
      if(!Array.isArray(entries)||entries.length<1||entries.length>500||
         (message.action==="save"&&message.role!=="user")||
         entries.some(pair=>!Array.isArray(pair)||!validId(pair[0])||
           !Number.isSafeInteger(pair[1])||pair[1]<946684800000||
           pair[1]>Date.now()+300000))throw Error("Invalid timestamp metadata");
      let changed=false;
      for(const [id,at] of entries){
        if(!Object.hasOwn(stored,id)){
          stored[id]=["user",at];changed=true;
        }
      }
      if(changed){
        const ids=Object.keys(stored);
        for(const old of ids.slice(0,Math.max(0,ids.length-10000)))delete stored[old];
        await chrome.storage.local.set({[key]:stored});
      }
      return {ok:true};
    };
    const operation=message.action==="read"?
      writes.catch(()=>{}).then(run):
      (writes=writes.catch(()=>{}).then(run));
    /* writes are serialized for both individual submissions and history pages. */
    operation.then(reply,error=>reply({ok:false,error:String(error)}));
    return true;
  });
})();