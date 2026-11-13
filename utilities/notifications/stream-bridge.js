/* MAIN-world completion observer. Parse verified final SSE messages without
 * requiring their DOM nodes, action bars or the network connection to close.
 * Only an assistant message ID and conversation ID cross into the isolated world. */
(() => {
  "use strict";
  if(window.__gptTweaksNotificationStream)return;
  window.__gptTweaksNotificationStream=true;

  const nativeFetch=window.fetch.bind(window);
  const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
  const conversationId=()=>location.pathname.match(
    /(?:^|\/)c\/([a-f0-9-]{36})(?:\/|$)/i)?.[1]||null;

  function generation(input,init){
    try{
      const raw=typeof input==="string"||input instanceof URL?input:input?.url;
      const url=new URL(raw,location.href);
      if(url.origin!==location.origin||
         !["/backend-api/f/conversation","/backend-api/conversation"].includes(url.pathname)||
         String(init?.method||input?.method||"GET").toUpperCase()!=="POST")return null;
      const body=typeof init?.body==="string"?JSON.parse(init.body):null;
      if(!Array.isArray(body?.messages))return null;
      return {conversation:validId(body.conversation_id)?
        body.conversation_id:conversationId()};
    }catch{return null;}
  }

  async function observe(response,initialConversation){
    if(!response?.ok||!response.body||
       !/text\/event-stream/i.test(response.headers?.get("content-type")||""))return;
    let clone;
    try{clone=response.clone();}catch{return;}
    const reader=clone.body.getReader();
    const decoder=new TextDecoder();
    const messages=new Map();
    let currentId=null,conversation=initialConversation,buffer="",dataLines=[];
    let published=false;

    function takeMessage(message){
      if(!validId(message?.id)||!message.author?.role)return;
      messages.set(message.id,message);
      currentId=message.id;
    }
    // These are the same nested ChatGPT delta shapes handled by Session Handoff.
    function applyOperation(op){
      if(!op||typeof op.p!=="string")return;
      if(op.p===""&&op.v?.message){takeMessage(op.v.message);return;}
      if(!op.p.startsWith("/message/")||!currentId)return;
      const message=messages.get(currentId);
      if(!message)return;
      const keys=op.p.slice(9).split("/").map(key=>
        key.replace(/~1/g,"/").replace(/~0/g,"~"));
      if(!["content","author","recipient","channel","metadata","end_turn","status"].includes(keys[0])||
         keys.length>8||keys.some(key=>
           ["__proto__","constructor","prototype"].includes(key)))return;
      let parent=message;
      for(let i=0;i<keys.length-1;i++){
        const key=keys[i];
        if(parent[key]==null)parent[key]=/^\d+$/.test(keys[i+1])?[]:{};
        if(!parent[key]||typeof parent[key]!=="object")return;
        parent=parent[key];
      }
      const key=keys[keys.length-1];
      if(op.o==="append"){
        if(typeof op.v==="string")
          parent[key]=(typeof parent[key]==="string"?parent[key]:"")+op.v;
        else if(Array.isArray(parent[key]))parent[key].push(op.v);
      }else if(op.o==="add"&&key==="-"&&Array.isArray(parent)){
        parent.push(op.v);
      }else if(op.o==="add"||op.o==="replace"){
        parent[key]=op.v;
      }
    }
    function publishFinal(){
      if(published)return;
      const finals=[...messages.values()].filter(message=>{
        const channel=message.channel||message.metadata?.channel;
        const status=typeof message.status==="string"?
          message.status:message.status?.type;
        return message.author?.role==="assistant"&&
          (!message.recipient||message.recipient==="all")&&
          (!channel||channel==="final")&&message.end_turn===true&&
          (status==null||status==="finished_successfully")&&
          message.metadata?.is_complete!==false&&
          message.metadata?.is_visually_hidden_from_conversation!==true;
      });
      const final=finals[finals.length-1];
      if(!final)return;
      published=true;
      document.dispatchEvent(new CustomEvent("gpt-tweaks:notifications:completed",{
        detail:JSON.stringify({
          id:final.id,
          conversation:validId(conversation)?conversation:conversationId()
        })
      }));
    }
    function handle(raw){
      if(!raw||raw==="[DONE]")return;
      let packet;
      try{packet=JSON.parse(raw);}catch{return;}
      if(validId(packet?.conversation_id))conversation=packet.conversation_id;
      if(validId(packet?.v?.conversation_id))conversation=packet.v.conversation_id;
      if(packet?.message)takeMessage(packet.message);
      if(packet?.v?.message)takeMessage(packet.v.message);
      if(Array.isArray(packet?.v))
        for(const op of packet.v)applyOperation(op);
      else if(packet?.o)applyOperation(packet);
      publishFinal();
    }
    function line(value){
      if(value.endsWith("\r"))value=value.slice(0,-1);
      if(!value){
        if(dataLines.length)handle(dataLines.join("\n"));
        dataLines=[];
      }else if(value.startsWith("data:"))dataLines.push(value.slice(5).trimStart());
    }
    try{
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        let offset;
        while((offset=buffer.indexOf("\n"))!==-1){
          line(buffer.slice(0,offset));
          buffer=buffer.slice(offset+1);
        }
        if(buffer.length>8_000_000)return;
      }
      buffer+=decoder.decode();
      if(buffer)line(buffer);
      line("");
    }catch{
      // A transport abort does not invalidate an already verified final reply.
    }finally{
      void reader.cancel().catch(()=>{});
      try{reader.releaseLock();}catch{}
    }
  }

  window.fetch=function(...args){
    const request=generation(args[0],args[1]);
    const result=nativeFetch(...args);
    if(request)void result.then(response=>observe(response,request.conversation))
      .catch(()=>{});
    return result;
  };
})();