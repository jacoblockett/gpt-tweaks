/* MAIN-world completion observer for ChatGPT generation SSE.
 * Do not depend on DOM/action bars or EOF. Observe final-channel message
 * markers and successful end_turn/status patches, then emit metadata only.
 * Original response and all ChatGPT network requests remain untouched. */
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
    const reader=clone.body.getReader(),decoder=new TextDecoder();
    const messages=new Map();
    let currentId=null,finalMarkerId=null,conversation=initialConversation;
    let buffer="",dataLines=[],published=false;

    function state(id){
      if(!validId(id))return null;
      if(!messages.has(id)){
        // Metadata only, never retain assistant message text.
        messages.set(id,{id,role:null,recipient:null,channel:null,
          status:null,endTurn:null,isComplete:null,hidden:false,finalMarker:false});
        if(messages.size>64)messages.delete(messages.keys().next().value);
      }
      return messages.get(id);
    }
    const statusOf=value=>typeof value==="string"?value:
      typeof value?.type==="string"?value.type:null;

    function readMetadata(item,metadata){
      if(!metadata||typeof metadata!=="object")return;
      if(typeof metadata.channel==="string")item.channel=metadata.channel;
      if(typeof metadata.is_complete==="boolean")item.isComplete=metadata.is_complete;
      if(typeof metadata.is_visually_hidden_from_conversation==="boolean")
        item.hidden=metadata.is_visually_hidden_from_conversation;
    }
    function takeMessage(message){
      const item=state(message?.id);
      if(!item)return;
      currentId=item.id;
      if(typeof message.author?.role==="string")item.role=message.author.role;
      if(typeof message.recipient==="string")item.recipient=message.recipient;
      if(typeof message.channel==="string")item.channel=message.channel;
      if(Object.hasOwn(message,"status"))item.status=statusOf(message.status);
      if(Object.hasOwn(message,"end_turn"))item.endTurn=message.end_turn;
      readMetadata(item,message.metadata);
    }
    function applyOperation(op){
      if(!op||typeof op.p!=="string")return;
      if((op.p===""&&op.v?.message)||op.p==="/message"&&op.v?.id){
        takeMessage(op.v?.message||op.v);return;
      }
      if(!op.p.startsWith("/message/")||!currentId)return;
      const item=state(currentId);
      if(!item)return;
      const path=op.p.slice("/message/".length).split("/").map(part=>
        part.replace(/~1/g,"/").replace(/~0/g,"~"));
      if(path.some(part=>["__proto__","prototype","constructor"].includes(part)))
        return;
      const field=path[0],sub=path[1];
      if(op.o==="remove"){
        if(field==="metadata"&&sub==="is_visually_hidden_from_conversation")
          item.hidden=false;
        else if(field==="metadata"&&sub==="is_complete")item.isComplete=null;
        else if(field==="metadata"&&sub==="channel")item.channel=null;
        return;
      }
      if(!["replace","add","append"].includes(op.o))return;
      // ChatGPT sends status and end_turn together in a final "patch" packet.
      if(field==="status"&&path.length===1)item.status=statusOf(op.v);
      else if(field==="end_turn"&&path.length===1)item.endTurn=op.v;
      else if(field==="author"){
        if(sub==="role"&&typeof op.v==="string")item.role=op.v;
        else if(path.length===1&&typeof op.v?.role==="string")
          item.role=op.v.role;
      }else if(field==="recipient"&&path.length===1&&typeof op.v==="string")
        item.recipient=op.v;
      else if(field==="channel"&&path.length===1&&typeof op.v==="string")
        item.channel=op.v;
      else if(field==="metadata"){
        if(path.length===1)readMetadata(item,op.v);
        else if(sub==="channel"&&typeof op.v==="string")item.channel=op.v;
        else if(sub==="is_complete"&&typeof op.v==="boolean")item.isComplete=op.v;
        else if(sub==="is_visually_hidden_from_conversation"&&
                typeof op.v==="boolean")item.hidden=op.v;
      }
    }
    function publishFinal(){
      if(published)return;
      const selected=[...messages.values()].filter(item=>
        (item.finalMarker||item.role==="assistant")&&
        (item.role===null||item.role==="assistant")&&
        (!item.recipient||item.recipient==="all")&&
        (!item.channel||item.channel==="final")&&
        item.status==="finished_successfully"&&item.endTurn===true&&
        item.isComplete!==false&&!item.hidden
      );
      const final=selected.at(-1);
      const id=validId(conversation)?conversation:conversationId();
      if(!final||!validId(id))return;
      published=true;
      document.dispatchEvent(new CustomEvent("gpt-tweaks:notifications:completed",{
        detail:JSON.stringify({id:final.id,conversation:id})
      }));
    }
    function handle(raw){
      if(!raw||raw==="[DONE]"){publishFinal();return;}
      let packet;
      try{packet=JSON.parse(raw);}catch{return;}
      if(validId(packet?.conversation_id))conversation=packet.conversation_id;
      if(validId(packet?.v?.conversation_id))conversation=packet.v.conversation_id;

      // A final_channel_token marker identifies the actual final assistant
      // message even when the SSE excerpt lacks its full initialization.
      if(packet?.type==="message_marker"&&validId(packet.message_id)&&
         packet.marker==="final_channel_token"&&packet.event==="first"){
        finalMarkerId=packet.message_id;
        const item=state(finalMarkerId);
        item.finalMarker=true;
        currentId=item.id;
      }
      if(packet?.message)takeMessage(packet.message);
      if(packet?.v?.message)takeMessage(packet.v.message);
      if(Array.isArray(packet?.v))
        for(const op of packet.v)applyOperation(op);
      else if(packet?.o)applyOperation(packet);
      publishFinal();

      if(packet?.type==="message_stream_complete"&&!published){
        // One metadata-only diagnostic per completed stream, with no text or
        // IDs, to distinguish missing initial messages from missing patches.
        const item=messages.get(finalMarkerId)||
          [...messages.values()].at(-1);
        console.warn("[GPT Tweaks] Final stream completed without a verified notification",{
          marker:!!finalMarkerId,role:item?.role||null,
          channel:item?.channel||null,status:item?.status||null,
          endTurn:item?.endTurn??null,conversationKnown:validId(conversation)
        });
      }
    }
    function line(value){
      if(value.endsWith("\r"))value=value.slice(0,-1);
      if(!value){
        if(dataLines.length)handle(dataLines.join("\n"));
        dataLines=[];
      }else if(value.startsWith("data:"))
        dataLines.push(value.slice(5).trimStart());
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
      // Transport aborts may follow a successfully completed final reply.
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