"use strict";
(() => {
  const setting="gpt-tweaks.notifications.enabled";
  const uuid=/^[a-f0-9-]{36}$/i;
  const prefix="gpt-tweaks:completion:";
  const seenPrefix="gpt-tweaks.notifications.last.";
  const pending=new Set();
  let creatingOffscreen=null;

  async function playSound(){
    try{
      const url=chrome.runtime.getURL("chrome/notification-sound.html");
      if(!creatingOffscreen){
        creatingOffscreen=(async()=>{
          const existing=await chrome.runtime.getContexts({
            contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[url]
          });
          if(existing.length)return;
          await chrome.offscreen.createDocument({
            url:"chrome/notification-sound.html",
            reasons:["AUDIO_PLAYBACK"],
            justification:"Play an audible alert when a background ChatGPT response completes."
          });
        })().finally(()=>{creatingOffscreen=null;});
      }
      await creatingOffscreen;
      const result=await chrome.runtime.sendMessage({
        type:"gpt-tweaks:notification:sound",target:"offscreen"
      });
      if(result?.ok!==true)throw Error(result?.error||"Sound playback unavailable");
    }catch(error){
      console.warn("[GPT Tweaks] Completion alert sound failed:",error);
    }
  }

  function authorized(sender){
    if(sender?.id!==chrome.runtime.id||!Number.isInteger(sender.tab?.id))
      return false;
    try{return new URL(sender.url).origin==="https://chatgpt.com";}
    catch{return false;}
  }
  function title(raw){
    const clean=String(raw||"").replace(/[\u0000-\u001f\u007f]/g," ")
      .trim().slice(0,150);
    const name=clean.replace(/\s*[-|·]\s*ChatGPT\s*$/i,"")
      .replace(/^ChatGPT\s*[-:|]\s*/i,"").trim();
    return name&&name.toLowerCase()!=="chatgpt"?"ChatGPT: "+name:"ChatGPT";
  }

  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message?.type!=="gpt-tweaks:notification"||message.action!=="show")
      return false;
    if(!authorized(sender)||!uuid.test(message.id||"")||
       !uuid.test(message.conversation||"")){
      respond({ok:false,error:"Unauthorized notification request"});
      return false;
    }
    const tabId=sender.tab.id;
    const notificationId=prefix+tabId+":"+message.id;
    const storeKey=seenPrefix+tabId;
    if(pending.has(notificationId)){
      respond({ok:true,duplicate:true});return false;
    }
    pending.add(notificationId);
    (async()=>{
      const saved=await chrome.storage.local.get(setting);
      if(saved[setting]==="false")return {ok:true,disabled:true};
      const prior=(await chrome.storage.session.get(storeKey))[storeKey];
      if(prior?.id===message.id)return {ok:true,duplicate:true};
      const allowed=await chrome.notifications.getPermissionLevel();
      if(allowed!=="granted")return {ok:false,error:"Browser notifications are disabled"};
      await chrome.notifications.create(notificationId,{
        type:"basic",iconUrl:chrome.runtime.getURL("assets/icon-128.png"),
        title:title(message.title),message:"New message",priority:1,
        silent:true
      });
      await chrome.storage.session.set({[storeKey]:{id:message.id,at:Date.now()}});
      void playSound();
      return {ok:true};
    })().then(respond,error=>respond({ok:false,error:String(error)}))
      .finally(()=>pending.delete(notificationId));
    return true;
  });

  chrome.notifications.onClicked.addListener(notificationId=>{
    const match=notificationId.match(/^gpt-tweaks:completion:(\d+):[a-f0-9-]{36}$/i);
    if(!match)return;
    const tabId=Number(match[1]);
    void (async()=>{
      const tab=await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId,{focused:true});
      await chrome.tabs.update(tabId,{active:true});
      await chrome.notifications.clear(notificationId);
    })().catch(error=>console.warn(
      "[GPT Tweaks] Could not focus completed conversation:",error));
  });
})();