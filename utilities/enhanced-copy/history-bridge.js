// Enhanced Copy reads authenticated conversation history only after an explicit
// user menu selection. Do not expose full history during passive observation.
(() => {
  "use strict";
  if(window.__gptTweaksCopyBridge)return;
  window.__gptTweaksCopyBridge=true;

  const nativeFetch=window.fetch.bind(window);
  const historyPrefix="/backend-api/conversations/";
  const knownHeaders=new Map();
  const conversationId=value=>typeof value==="string"&&/^[0-9a-f-]{36}$/i.test(value);
  const requests=new Map();

  function identify(input) {
    try{
      const url=new URL(typeof input==="string"||input instanceof URL?input:input?.url,location.href);
      const id=url.pathname.startsWith(historyPrefix)?url.pathname.slice(historyPrefix.length):null;
      return url.origin===location.origin&&conversationId(id)?id:null;
    }catch{return null;}
  }
  function captureHeaders(id,input,init) {
    try{
      const headers=new Headers(input instanceof Request?input.headers:undefined);
      if(init?.headers)new Headers(init.headers).forEach((value,key)=>headers.set(key,value));
      knownHeaders.set(id,headers);
    }catch{}
  }
  window.fetch=function(...args){
    const id=identify(args[0]);
    if(id&&String(args[1]?.method||args[0]?.method||"GET").toUpperCase()==="GET" &&
       !new URL(typeof args[0]==="string"||args[0] instanceof URL?args[0]:args[0].url,location.href).searchParams.has("before"))
      captureHeaders(id,args[0],args[1]);
    return nativeFetch(...args);
  };

  function textPart(value){
    if(typeof value==="string")return value;
    if(!value||typeof value!=="object")return "";
    if(typeof value.text==="string")return value.text;
    if(typeof value.content==="string")return value.content;
    if(typeof value.title==="string")return "[Attachment: "+value.title+"]";
    if(typeof value.name==="string")return "[Attachment: "+value.name+"]";
    if(typeof value.asset_pointer==="string"||value.content_type==="image_asset_pointer")
      return "[Image]";
    return "";
  }
  function dialogue(message){
    if(!message||typeof message.id!=="string")return null;
    const role=message.author?.role;
    const metadata=message.metadata||{};
    if(metadata.is_visually_hidden_from_conversation===true||
       metadata.is_user_system_message===true||
       ["user_editable_context","model_editable_context"].includes(message.content?.content_type))
      return null;
    const channel=message.channel||metadata.channel;
    if(role!=="user" && !(role==="assistant"&&
      message.recipient==="all"&&message.end_turn===true&&(!channel||channel==="final")))
      return null;
    const parts=message.content?.parts;
    let text=Array.isArray(parts)?parts.map(textPart).filter(Boolean).join("\n"):"";
    if(!text&&typeof message.content?.text==="string")text=message.content.text;
    if(!text&&role==="user"&&message.content?.content_type==="multimodal_text")
      text="[Non-text message]";
    if(!text)return null;
    return {id:message.id,role,text:text.trim()};
  }
  async function readConversation(id,signal) {
    const headers=new Headers(knownHeaders.get(id));
    if(!headers.has("accept"))headers.set("accept","application/json");
    if(!headers.has("chatgpt-account-id")){
      const account=document.documentElement.dataset.themeAccountId;
      if(account)headers.set("chatgpt-account-id",account);
    }
    if(!headers.has("x-openai-codex-window-type")){
      const windowType=document.documentElement.dataset.codexWindowType;
      if(windowType)headers.set("x-openai-codex-window-type",windowType);
    }
    if(!headers.has("x-openai-web-frontend")&&
       document.documentElement.dataset.codexWindowType==="browser")
      headers.set("x-openai-web-frontend","codex_webview");

    let before=null;
    const cursors=new Set(),seen=new Set();
    let messages=[];
    for(let page=0;page<200;page++){
      if(signal.aborted)throw Error("Copy canceled");
      const url=new URL(historyPrefix+encodeURIComponent(id),location.origin);
      url.searchParams.set("num_turns","10");
      url.searchParams.set("include_has_versions","true");
      if(before)url.searchParams.set("before",before);
      let response;
      for(let attempt=0;attempt<3;attempt++){
        try{
          response=await nativeFetch(url.href,{method:"GET",headers,
            credentials:"include",cache:"no-store",signal});
          break;
        }catch(error){
          if(signal.aborted||error?.name!=="TypeError"||attempt===2)throw error;
          await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
        }
      }
      if(!response.ok)throw Error("History request returned HTTP "+response.status);
      const data=await response.json();
      if(!Array.isArray(data?.messages)||!data.page_info)
        throw Error("Unsupported conversation history response");
      const older=[];
      for(const raw of data.messages){
        const item=dialogue(raw);
        if(item&&!seen.has(item.id)){seen.add(item.id);older.push(item);}
      }
      messages=older.concat(messages);
      if(messages.length>12000||messages.reduce((n,item)=>n+item.text.length,0)>8_000_000)
        throw Error("Conversation is too large to copy safely");
      if(!data.page_info.has_previous_page)return messages;
      const cursor=data.page_info.start_cursor;
      if(typeof cursor!=="string"||!cursor||cursors.has(cursor))
        throw Error("History pagination did not advance");
      cursors.add(cursor);
      before=cursor;
    }
    throw Error("Conversation history exceeds the pagination limit");
  }
  document.addEventListener("gpt-tweaks:copy:request",async event=>{
    let packet;
    try{packet=JSON.parse(event.detail);}catch{return;}
    if(!packet||!conversationId(packet.conversationId)||
       !/^[a-z0-9_-]{12,80}$/i.test(packet.id||"")||
       !["before","after","all"].includes(packet.scope)||requests.has(packet.id))
      return;
    const controller=new AbortController();
    requests.set(packet.id,controller);
    function result(ok,value){
      document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:result",{
        detail:JSON.stringify(ok?{id:packet.id,ok:true,text:value}:
          {id:packet.id,ok:false,error:String(value)})
      }));
    }
    try{
      const items=await readConversation(packet.conversationId,controller.signal);
      const selected=items.findIndex(item=>item.id===packet.messageId);
      if(packet.scope!=="all"&&selected<0)
        throw Error("Selected message could not be matched to conversation history");
      const subset=packet.scope==="all"?items:
        packet.scope==="before"?items.slice(0,selected+1):items.slice(selected);
      if(!subset.length)throw Error("No messages available to copy");
      const text=subset.map(item=>"## "+(item.role==="user"?"User":"Assistant")+
        "\n\n"+item.text).join("\n\n---\n\n");
      result(true,text);
    }catch(error){
      if(!controller.signal.aborted)result(false,error?.message||String(error));
    }finally{requests.delete(packet.id);}
  });
  document.addEventListener("gpt-tweaks:copy:cancel",event=>{
    requests.get(event.detail)?.abort();
  });
})();
