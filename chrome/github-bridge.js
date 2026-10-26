"use strict";
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!message?.kind?.startsWith("gpt-github-")) return;
  const source=sender.url||"";
  if(sender.id!==chrome.runtime.id ||
    !(source.startsWith("https://chatgpt.com/")||source.startsWith(chrome.runtime.getURL("settings/")))) {
    respond({ok:false,error:"Unauthorized request."});return;
  }
  Promise.resolve().then(()=>globalThis.__gptTweaksGitHubDispatch(message)).then(data=>respond({ok:true,data}),
    error=>respond({ok:false,error:error?.message||String(error),code:error?.code||""}));
  return true;
});
