/* MAIN-world timestamps: metadata only. Never modify ChatGPT responses. */
(() => {
  "use strict";
  if(window.__gptTweaksTimestampBridge)return;
  window.__gptTweaksTimestampBridge=true;
  const originalFetch=window.fetch.bind(window);
  const history=window.GPTTweaksConversationHistory;
  const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);
  const publish=(type,payload)=>document.dispatchEvent(new CustomEvent(
    "gpt-tweaks:timestamps:"+type,{detail:JSON.stringify(payload)}));

  document.addEventListener("gpt-tweaks:timestamps:lookup",async event=>{
    let request;
    try{request=JSON.parse(event.detail);}catch{return;}
    const {conversation,seq,ids}=request||{};
    if(!validId(conversation)||!Number.isSafeInteger(seq)||
       !Array.isArray(ids)||ids.length>100||ids.some(id=>!validId(id)))return;
    const wanted=new Set(ids),found=[];
    if(!wanted.size)return;
    try {
      await history.scan(conversation,{maxPages:500,onPage:page=>{
        for(const message of page.messages){
          if(!wanted.has(message?.id)||message.author?.role!=="user"||
             message.metadata?.is_visually_hidden_from_conversation===true||
             message.metadata?.is_user_system_message===true)continue;
          // create_time is not assumed to be a completion timestamp.
          // Display it only for users, if an actual history response supplies it.
          const seconds=message.create_time;
          if(typeof seconds!=="number"||!Number.isFinite(seconds)||
             seconds<946684800||seconds>Date.now()/1000+300)continue;
          found.push({id:message.id,at:Math.round(seconds*1000)});
          wanted.delete(message.id);
        }
        return wanted.size>0;
      }});
      publish("history",{conversation,seq,entries:found});
    }catch(error){
      publish("history",{conversation,seq,entries:found,error:String(error)});
    }
  });

  function generation(input,init){
    try{
      const raw=typeof input==="string"||input instanceof URL?input:input?.url;
      const url=new URL(raw,location.href);
      if(url.origin!==location.origin||
         !["/backend-api/f/conversation","/backend-api/conversation"].includes(url.pathname)||
         String(init?.method||input?.method||"GET").toUpperCase()!=="POST")
        return null;
      const body=typeof init?.body==="string"?JSON.parse(init.body):null;
      if(!Array.isArray(body?.messages))return null;
      return {conversation:validId(body.conversation_id)?body.conversation_id:null,
        users:body.messages.filter(m=>m?.author?.role==="user"&&validId(m.id))
          .map(m=>m.id),at:Date.now()};
    }catch{return null;}
  }
  async function observe(response,request){
    if(!response?.body||!/text\/event-stream/i.test(
      response.headers?.get("content-type")||""))return;
    let copy;
    try{copy=response.clone();}catch{return;}
    const reader=copy.body.getReader(),decoder=new TextDecoder();
    const messages=new Map();
    let currentId=null,conversation=request.conversation,buffer="",dataLines=[],ended=false;
    const take=m=>{
      if(!validId(m?.id)||!m.author?.role)return;
      messages.set(m.id,m);
      currentId=m.id;
    };
    const operation=op=>{
      if(!op||typeof op.p!=="string")return;
      if(op.p===""&&op.v?.message){take(op.v.message);return;}
      if(!op.p.startsWith("/message/")||!currentId)return;
      const parts=op.p.slice(9).split("/");
      if(!parts.length||parts.length>2||
         !["end_turn","status","channel","recipient","metadata"].includes(parts[0])||
         (parts.length===2&&(!["channel","is_complete","is_visually_hidden_from_conversation"].includes(parts[1])||
          parts[0]!=="metadata")))return;
      const m=messages.get(currentId);
      if(!m||!["add","replace"].includes(op.o))return;
      if(parts.length===1)m[parts[0]]=op.v;
      else{
        if(!m.metadata||typeof m.metadata!=="object")m.metadata={};
        m.metadata[parts[1]]=op.v;
      }
    };
    const handle=raw=>{
      if(!raw||raw==="[DONE]")return;
      let p;
      try{p=JSON.parse(raw);}catch{return;}
      if(validId(p?.conversation_id))conversation=p.conversation_id;
      if(validId(p?.v?.conversation_id))conversation=p.v.conversation_id;
      if(p?.message)take(p.message);
      if(p?.v?.message)take(p.v.message);
      if(Array.isArray(p?.v))for(const op of p.v)operation(op);
      else if(p?.o)operation(p);
    };
    const line=s=>{
      if(s.endsWith("\r"))s=s.slice(0,-1);
      if(!s){if(dataLines.length)handle(dataLines.join("\n"));dataLines=[];}
      else if(s.startsWith("data:"))dataLines.push(s.slice(5).trimStart());
    };
    try{
      while(true){
        const {value,done}=await reader.read();
        if(done){ended=true;break;}
        buffer+=decoder.decode(value,{stream:true});
        let pos;
        while((pos=buffer.indexOf("\n"))!==-1){
          line(buffer.slice(0,pos));buffer=buffer.slice(pos+1);
        }
        if(buffer.length>8000000)return;
      }
      buffer+=decoder.decode();
      if(buffer)line(buffer);
      line("");
    }catch{return;}
    finally{
      if(!ended)void reader.cancel().catch(()=>{});
      try{reader.releaseLock();}catch{}
    }
    if(!ended)return; // An interrupted stream does not establish completion.
    const completed=[...messages.values()].filter(m=>{
      const status=typeof m.status==="string"?m.status:m.status?.type;
      const channel=m.channel||m.metadata?.channel;
      return m.author?.role==="assistant"&&(!m.recipient||m.recipient==="all")&&
        (!channel||channel==="final")&&m.end_turn===true&&
        (status==null||status==="finished_successfully")&&
        m.metadata?.is_complete!==false&&
        m.metadata?.is_visually_hidden_from_conversation!==true;
    });
    const final=completed[completed.length-1];
    if(final)publish("final",{id:final.id,conversation});
  }
  window.fetch=function(...args){
    const request=generation(args[0],args[1]);
    const result=originalFetch(...args);
    if(request)void result.then(response=>{
      if(!response?.ok)return;
      for(const id of request.users)
        publish("submitted",{id,conversation:request.conversation,at:request.at});
      void observe(response,request);
    }).catch(()=>{});
    return result;
  };
})();