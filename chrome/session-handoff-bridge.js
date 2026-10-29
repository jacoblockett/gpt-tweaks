"use strict";
(() => {
  const prefix="gpt-tweaks.handoff.pending.";
  const enabledKey="gpt-tweaks.handoff.enabled";
  const modelPattern=/^[a-z0-9][a-z0-9._-]{0,99}$/i;
  const effortPattern=/^[a-z][a-z0-9_-]{0,30}$/i;
  function authorized(sender) {
    if(sender?.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id))return false;
    try{return new URL(sender.url).origin==="https://chatgpt.com";}catch{return false;}
  }
  function destination(pathname) {
    const match=String(pathname||"").match(/^\/g\/(g-p-[A-Za-z0-9_-]+)(?:\/|$)/);
    return match?"/g/"+match[1]+"/project":"/";
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(!["status","prepare","read","complete"].includes(message?.action)||
       message?.type!=="gpt-tweaks:handoff")return false;
    if(!authorized(sender)){reply({ok:false,error:"Unauthorized handoff request"});return false;}
    (async()=>{
      const key=prefix+sender.tab.id;
      const action=message.action;
      if(action==="status"){
        const saved=await chrome.storage.local.get(enabledKey);
        return {ok:true,enabled:saved[enabledKey]!=="false"};
      }
      if(action==="prepare"){
        const saved=await chrome.storage.local.get(enabledKey);
        if(saved[enabledKey]==="false")throw Error("Session handoff is disabled");
        if(typeof message.text!=="string"||message.text.length<80||message.text.length>512000)
          throw Error("Invalid session handoff contents");
        const target=destination(message.pathname);
        const model=modelPattern.test(message.model||"")?message.model:null;
        const effort=effortPattern.test(message.effort||"")?message.effort:null;
        await chrome.storage.session.set({[key]:{
          text:message.text,target,created:Date.now(),model,effort
        }});
        return {ok:true,target};
      }
      const data=(await chrome.storage.session.get(key))[key];
      if(!data)return {ok:true,pending:false};
      if(Date.now()-data.created>30*60*1000){
        await chrome.storage.session.remove(key);
        return {ok:true,pending:false};
      }
      if(message.pathname!==data.target)return {ok:true,pending:false};
      if(action==="complete"){
        await chrome.storage.session.remove(key);
        return {ok:true};
      }
      return {ok:true,pending:true,text:data.text,
        model:data.model||null,effort:data.effort||null};
    })().then(reply,error=>reply({ok:false,error:String(error)}));
    return true;
  });
})();