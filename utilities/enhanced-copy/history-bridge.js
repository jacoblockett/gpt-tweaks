/* Enhanced Copy consumes the shared authenticated history transport.
 * Full message text is fetched only after a user explicitly selects a
 * multi-message copy operation; it is not retained after that operation. */
(() => {
  "use strict";
  if(window.__gptTweaksCopyBridge)return;
  window.__gptTweaksCopyBridge=true;
  const history=window.GPTTweaksConversationHistory;
  const structured=window.GPTTweaksConversationContent;
  if(!history||!structured)throw Error("Shared conversation history modules are missing");
  const requests=new Map();
  const validId=value=>typeof value==="string"&&/^[a-f0-9-]{36}$/i.test(value);

  function dialogue(message){
    if(!message||!validId(message.id))return null;
    const role=message.author?.role;
    const metadata=message.metadata||{};
    const channel=message.channel||metadata.channel;
    if(metadata.is_visually_hidden_from_conversation===true||
       metadata.is_user_system_message===true||
       ["user_editable_context","model_editable_context"].includes(message.content?.content_type))
      return null;
    if(role!=="user"&&!(role==="assistant"&&
       (message.recipient||"all")==="all"&&message.end_turn===true&&
       (!channel||channel==="final")))return null;
    // The same structured parser used for token estimates retains original
    // Markdown strings and avoids duplicate text/content aliases. Thoughts
    // belong to internal reasoning, not the visible dialogue transcript.
    const text=structured.contentTexts(message.content,false).join("\n").trim();
    return {id:message.id,role,text:text||"[Non-text content]"};
  }

  async function collect(id,signal){
    const pages=[];
    const seen=new Set();
    let count=0,characters=0;
    await history.scan(id,{signal,onPage:page=>{
      const entries=[];
      for(const raw of page.messages){
        const item=dialogue(raw);
        if(!item||seen.has(item.id))continue;
        seen.add(item.id);
        entries.push(item);
        count++;
        characters+=item.text.length;
        if(count>100000||characters>60000000)
          throw Error("Conversation is too large for a single clipboard copy");
      }
      // History pages arrive newest-first, with each page oldest-to-newest.
      pages.push(entries);
    }});
    return pages.reverse().flat();
  }

  document.addEventListener("gpt-tweaks:copy:request",async event=>{
    let packet;
    try{packet=JSON.parse(event.detail);}catch{return;}
    if(!packet||!validId(packet.conversationId)||
       !/^[a-z0-9_-]{12,80}$/i.test(packet.id||"")||
       packet.scope!=="all"||requests.has(packet.id))return;
    const controller=new AbortController();
    requests.set(packet.id,controller);
    const report=(ok,value)=>{
      document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:result",{
        detail:JSON.stringify(ok?{id:packet.id,ok:true,text:value}:
          {id:packet.id,ok:false,error:String(value)})
      }));
    };
    try{
      const items=await collect(packet.conversationId,controller.signal);
      if(controller.signal.aborted)return;
      if(!items.length)throw Error("No messages available to copy");
      report(true,items.map(item=>"## "+(item.role==="user"?"User":"Assistant")+
        "\n\n"+item.text).join("\n\n---\n\n"));
    }catch(error){
      if(!controller.signal.aborted)report(false,error?.message||String(error));
    }finally{requests.delete(packet.id);}
  });
  document.addEventListener("gpt-tweaks:copy:cancel",event=>{
    requests.get(event.detail)?.abort();
  });
})();
