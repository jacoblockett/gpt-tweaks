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

  async function collect(id,signal,onMoreHistory){
    const newestFirstPages=[];
    const seen=new Set();
    let count=0,characters=0;
    await history.scan(id,{signal,onPage:(page,pageIndex)=>{
      // The first response confirms whether older, virtualized pages are
      // required; notify UI without sending history contents across worlds.
      if(pageIndex===0&&page.page_info.has_previous_page)onMoreHistory?.();
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
      newestFirstPages.push(entries);
    }});
    // Each history page is ordered oldest-to-newest; pages arrive newest-first.
    return newestFirstPages.reverse().flat();
  }
  document.addEventListener("gpt-tweaks:copy:request",async event=>{
    let packet;
    try{packet=JSON.parse(event.detail);}catch{return;}
    if(!packet||!validId(packet.conversationId)||
       !/^[a-z0-9_-]{12,80}$/i.test(packet.id||"")||
       !["before","after","all"].includes(packet.scope)||requests.has(packet.id))
      return;
    const candidates=Array.isArray(packet.messageIds)?
      packet.messageIds.filter(validId).slice(0,20):
      (validId(packet.messageId)?[packet.messageId]:[]);
    const controller=new AbortController();
    requests.set(packet.id,controller);
    const report=(ok,value)=>{
      document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:result",{
        detail:JSON.stringify(ok?{id:packet.id,ok:true,text:value}:
          {id:packet.id,ok:false,error:String(value)})
      }));
    };
    try{
      const items=await collect(packet.conversationId,controller.signal,()=>{
        document.dispatchEvent(new CustomEvent("gpt-tweaks:copy:progress",{
          detail:packet.id
        }));
      });
      if(controller.signal.aborted)return;
      if(!items.length)throw Error("No messages available to copy");
      let selected=-1;
      if(packet.scope!=="all"){
        const candidatesSet=new Set(candidates);
        const matches=[];
        for(let i=0;i<items.length;i++)
          if(items[i].role===packet.role&&candidatesSet.has(items[i].id))matches.push(i);
        const preferred=matches.find(index=>
          items[index].id===packet.preferredMessageId);
        if(preferred!==undefined)selected=preferred;
        else if(matches.length===1)selected=matches[0];
        else if(matches.length>1)
          throw Error("Multiple message versions match this copy button; cannot select safely");
        if(selected<0&&validId(packet.turnKey)){
          // An assistant action can belong to a parent turn keyed by its
          // user message rather than by the assistant's final message ID.
          const userIndex=items.findIndex(item=>
            item.role==="user"&&item.id===packet.turnKey);
          if(packet.role==="user")selected=userIndex;
          else if(packet.role==="assistant"&&userIndex>=0){
            const replies=[];
            for(let i=userIndex+1;i<items.length&&items[i].role!=="user";i++)
              if(items[i].role==="assistant")replies.push(i);
            // Only infer from a parent turn when there is exactly one
            // eligible final reply. Never guess which branch was clicked.
            if(replies.length===1)selected=replies[0];
            else if(replies.length>1)
              throw Error("Multiple assistant replies exist in this turn; cannot identify the selected version");
          }
        }
        if(selected<0)throw Error("Selected message could not be matched to conversation history");
      }
      const subset=packet.scope==="all"?items:
        packet.scope==="before"?items.slice(0,selected+1):items.slice(selected);
      const transcript=subset.map(item=>"## "+(item.role==="user"?"User":"Assistant")+
        "\n\n"+item.text).join("\n\n---\n\n");
      report(true,transcript);
    }catch(error){
      if(!controller.signal.aborted)report(false,error?.message||String(error));
    }finally{requests.delete(packet.id);}
  });
  document.addEventListener("gpt-tweaks:copy:cancel",event=>{
    requests.get(event.detail)?.abort();
  });
})();
