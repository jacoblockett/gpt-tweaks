// MAIN-world observer for the current handoff generation only. The original
// response remains untouched; completed Markdown travels to the isolated
// handoff utility. No conversation-history or file-download requests are made.
(() => {
  "use strict";
  if(window.__gptTweaksHandoffStream)return;
  window.__gptTweaksHandoffStream=true;

  const nativeFetch=window.fetch.bind(window);
  const marker="GPT Tweaks session handoff request.";
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

  function isHandoff(input,init) {
    try {
      const raw=typeof input==="string"||input instanceof URL?input:input?.url;
      const url=new URL(raw,location.href);
      if(url.origin!==location.origin||
         !["/backend-api/f/conversation","/backend-api/conversation"].includes(url.pathname)||
         String(init?.method||input?.method||"GET").toUpperCase()!=="POST")
        return false;
      const body=typeof init?.body==="string"?JSON.parse(init.body):null;
      return !!body?.messages?.some(message=>message.author?.role==="user"&&
        message.content?.parts?.some(part=>typeof part==="string"&&part.includes(marker)));
    }catch{return false;}
  }

  async function collectMarkdown(response) {
    if(!response?.ok||!response.body||
       !/text\/event-stream/i.test(response.headers?.get("content-type")||""))
      throw Error("Handoff generation did not return a successful event stream");

    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    const messages=new Map();
    let currentId=null,buffer="",dataLines=[],streamEnded=false;

    function takeMessage(message) {
      if(!message||typeof message.id!=="string"||!message.author?.role)return;
      currentId=message.id;
      messages.set(message.id,message);
    }
    // Follow the same ChatGPT delta shapes already handled by Token Estimator.
    function applyOperation(op) {
      if(!op||typeof op.p!=="string")return;
      if(op.p===""&&op.v?.message){takeMessage(op.v.message);return;}
      if(!op.p.startsWith("/message/")||!currentId)return;
      const message=messages.get(currentId);
      if(!message)return;
      const keys=op.p.slice(9).split("/").map(key=>
        key.replace(/~1/g,"/").replace(/~0/g,"~"));
      if(!["content","author","recipient","channel","metadata","end_turn","status"].includes(keys[0])||
         keys.length>8||keys.some(key=>["__proto__","constructor","prototype"].includes(key)))
        return;
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
    function handle(raw) {
      if(!raw||raw==="[DONE]")return;
      let packet;
      try{packet=JSON.parse(raw);}catch{return;}
      if(packet?.message)takeMessage(packet.message);
      if(packet?.v?.message)takeMessage(packet.v.message);
      if(Array.isArray(packet?.v))
        for(const op of packet.v)applyOperation(op);
      else if(packet?.o)applyOperation(packet);
    }
    function acceptLine(line) {
      if(line.endsWith("\r"))line=line.slice(0,-1);
      if(!line){
        if(dataLines.length)handle(dataLines.join("\n"));
        dataLines=[];
      }else if(line.startsWith("data:")){
        dataLines.push(line.slice(5).trimStart());
      }
    }
    try {
      while(true){
        const {value,done}=await reader.read();
        if(done){streamEnded=true;break;}
        buffer+=decoder.decode(value,{stream:true});
        let boundary;
        while((boundary=buffer.indexOf("\n"))!==-1){
          acceptLine(buffer.slice(0,boundary));
          buffer=buffer.slice(boundary+1);
        }
        if(buffer.length>8_000_000)throw Error("Handoff response stream exceeded parser limit");
      }
      buffer+=decoder.decode();
      if(buffer)acceptLine(buffer);
      acceptLine("");
    }catch(error){
      // Browser transport may abort after the final end_turn delta.
      // Accept only if a completed final message was already observed.
      if(error?.name!=="AbortError")throw error;
    }finally{
      try{reader.releaseLock();}catch{}
    }

    const replies=[...messages.values()].filter(message=>{
      const channel=message.channel||message.metadata?.channel;
      const status=typeof message.status==="string"?message.status:message.status?.type;
      return message.author?.role==="assistant"&&
        (!message.recipient||message.recipient==="all")&&
        (!channel||channel==="final")&&message.end_turn===true&&
        (status==null||status==="finished_successfully")&&
        message.metadata?.is_complete!==false;
    });
    const reply=replies[replies.length-1];
    if(!reply)throw Error("No completed final handoff reply was found in the generation stream");
    const parts=reply.content?.parts;
    if(!Array.isArray(parts)||!parts.every(part=>typeof part==="string"))
      throw Error("Final handoff reply did not contain plain Markdown text");
    const text=parts.join("\n").replace(/\r\n/g,"\n").trim();
    if(text.length<80||text.length>512000)
      throw Error("Completed handoff text is missing or too large");
    if(/sandbox:\/mnt\/data\/|\]\(sandbox:/i.test(text))
      throw Error("Handoff response contained a file reference instead of text");
    return text;
  }

  window.fetch=function(...args) {
    if(!armed||!isHandoff(args[0],args[1]))return nativeFetch(...args);
    const {id}=armed;
    armed=null;
    const result=nativeFetch(...args);
    void result.then(async response=>{
      // Observe a clone: ChatGPT and Token Estimator continue unmodified.
      const text=await collectMarkdown(response.clone());
      report(id,true,text);
    }).catch(error=>report(id,false,error));
    return result;
  };
})();
