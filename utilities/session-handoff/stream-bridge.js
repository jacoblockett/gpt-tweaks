// The handoff utility owns this MAIN-world bridge. It observes only its own
// generation, leaves ChatGPT's response untouched, and reads its finished file.
(() => {
  "use strict";
  if(window.__gptTweaksHandoffStream)return;
  window.__gptTweaksHandoffStream=true;

  const nativeFetch=window.fetch.bind(window);
  const filename="Session-Handoff.md";
  const marker="為本對話製交接文件";
  let armed=null;

  function report(id,ok,value) {
    document.dispatchEvent(new CustomEvent("gpt-tweaks:handoff:result",{
      detail:JSON.stringify(ok?{id,ok:true,text:value}:{id,ok:false,error:String(value)})
    }));
  }
  document.addEventListener("gpt-tweaks:handoff:arm",event=>{
    const id=event.detail;
    if(typeof id==="string"&&/^[a-zA-Z0-9_-]{12,80}$/.test(id))
      armed={id};
  });
  document.addEventListener("gpt-tweaks:handoff:disarm",event=>{
    if(armed?.id===event.detail)armed=null;
  });

  function requestData(input,init) {
    try {
      const url=new URL(typeof input==="string"||input instanceof URL?input:input?.url,location.href);
      if(url.origin!==location.origin||!["/backend-api/f/conversation","/backend-api/conversation"].includes(url.pathname))
        return null;
      if(String(init?.method||input?.method||"GET").toUpperCase()!=="POST")return null;
      const body=typeof init?.body==="string"?JSON.parse(init.body):null;
      const outgoing=body?.messages?.find(m=>
        m.author?.role==="user"&&
        m.content?.parts?.some(part=>typeof part==="string"&&part.includes(marker)));
      if(!outgoing?.id)return null;
      const conversationId=body.conversation_id||
        location.pathname.match(/(?:^|\/)c\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
      if(!/^[0-9a-f-]{36}$/i.test(conversationId||""))return null;
      const headers=new Headers(input instanceof Request?input.headers:undefined);
      if(init?.headers)new Headers(init.headers).forEach((value,key)=>headers.set(key,value));
      // Reuse only benign routing context; never expose auth or proof headers.
      const routing=new Headers();
      for(const key of [
        "chatgpt-account-id","chatgpt-project-id","oai-device-id","oai-did",
        "oai-language","originator","x-openai-codex-window-type",
        "x-openai-web-frontend","x-openai-rate-limit-join-workspace"
      ]){
        if(headers.has(key))routing.set(key,headers.get(key));
      }
      return {conversationId,userId:outgoing.id,headers:routing};
    }catch{return null;}
  }
  async function streamEnded(response) {
    if(!response.ok||!response.body||
       !/text\/event-stream/i.test(response.headers.get("content-type")||""))
      throw Error("Handoff generation did not return a successful event stream");
    const reader=response.body.getReader();
    try {
      while(true){
        const {done}=await reader.read();
        if(done)return;
      }
    }catch(error){
      // ChatGPT may abort its SSE transport after committing the answer.
      // An aborted transport is not proof of a failed final turn; the saved
      // conversation record below is the authority for that distinction.
      if(error?.name!=="AbortError")throw error;
    }finally{reader.releaseLock();}
  }
  function completedReply(history,userId) {
    if(!Array.isArray(history?.messages))return null;
    const userIndex=history.messages.findIndex(m=>m.id===userId&&m.author?.role==="user");
    if(userIndex<0)return null;
    const after=history.messages.slice(userIndex+1);
    const reply=after.findLast(m=>m.author?.role==="assistant" &&
      m.recipient==="all" && m.end_turn===true);
    return reply||null;
  }
  function sandboxPath(reply) {
    if(reply.status!=="finished_successfully"||reply.metadata?.is_complete!==true)
      throw Error("ChatGPT did not complete the handoff response successfully");
    const parts=reply.content?.parts;
    const text=Array.isArray(parts)?parts.filter(part=>typeof part==="string").join("\n"):"";
    const match=text.match(/sandbox:(\/mnt\/data\/Session-Handoff\.md)(?=[)#\s]|$)/);
    if(!match)throw Error("The completed response did not include Session-Handoff.md");
    return match[1];
  }
  async function finishedMessage(info) {
    // Match the successful ChatGPT history request captured in the HAR and
    // already used by the Token Estimator. An unparameterized URL returned
    // HTTP 404 in the live handoff test.
    const url=new URL("/backend-api/conversations/"+
      encodeURIComponent(info.conversationId),location.origin);
    url.searchParams.set("num_turns","2");
    url.searchParams.set("include_has_versions","true");
    const headers=new Headers(info.headers);
    headers.set("accept","application/json");
    let lastStatus=null;
    for(let attempt=0;attempt<7;attempt++){
      const response=await nativeFetch(url.href,{
        method:"GET",credentials:"include",cache:"no-store",headers
      });
      lastStatus=response.status;
      if(response.ok){
        const history=await response.json();
        const reply=completedReply(history,info.userId);
        if(reply)return reply;
      }else if(response.status!==404){
        throw Error("Conversation verification failed (HTTP "+response.status+")");
      }
      // A 404 immediately after generation can also mean the completed
      // conversation has not propagated to the history service yet.
      if(attempt<6)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
    throw Error("Completed handoff reply unavailable in conversation history"+
      (lastStatus===404?" (HTTP 404)":""));
  }
  async function readMarkdown(info,reply) {
    const path=sandboxPath(reply);
    const params=new URLSearchParams({
      download_intent:"false",message_id:reply.id,sandbox_path:path
    });
    const url="/backend-api/conversation/"+encodeURIComponent(info.conversationId)+
      "/interpreter/download?"+params;
    const ticket=await nativeFetch(url,{credentials:"include",headers:info.headers});
    if(!ticket.ok)throw Error("Handoff file lookup failed (HTTP "+ticket.status+")");
    const details=await ticket.json();
    if(details.status!=="success"||details.file_name!==filename||
       !/^text\/(markdown|plain)(?:;|$)/i.test(details.mime_type||"")||
       typeof details.download_url!=="string")
      throw Error("Handoff download metadata was invalid");
    const destination=new URL(details.download_url,location.origin);
    if(destination.origin!==location.origin||destination.protocol!=="https:")
      throw Error("Handoff download address was not trusted");
    const response=await nativeFetch(destination.href,{credentials:"include",
      headers:info.headers.has("chatgpt-account-id")?
        {"chatgpt-account-id":info.headers.get("chatgpt-account-id")}:undefined});
    if(!response.ok)throw Error("Handoff file download failed (HTTP "+response.status+")");
    if(/text\/html/i.test(response.headers.get("content-type")||""))
      throw Error("Handoff file download returned HTML");
    const text=(await response.text()).replace(/\r\n/g,"\n");
    if(text.length<80||text.length>512000)
      throw Error("Handoff Markdown is missing or too large");
    return text;
  }
  window.fetch=function(...args){
    if(!armed)return nativeFetch(...args);
    const info=requestData(args[0],args[1]);
    if(!info)return nativeFetch(...args);
    const {id}=armed;
    armed=null;
    const result=nativeFetch(...args);
    void result.then(async response=>{
      // Observe a clone exactly like the Token Estimator; no impact on the
      // original SSE stream, even when token estimation is disabled.
      await streamEnded(response.clone());
      const reply=await finishedMessage(info);
      const text=await readMarkdown(info,reply);
      report(id,true,text);
    }).catch(reason=>report(id,false,reason));
    return result;
  };
})();
