/* Read a complete rendered copy range before making any history request.
 * This is deliberately conservative: incomplete virtualized turns, ambiguous
 * boundaries, unsupported rich content, or an unknown timeline end fall back
 * to the authenticated history reader. Nothing is cached. */
(() => {
  "use strict";
  if(globalThis.GPTTweaksEnhancedCopyLocal)return;
  const marker=/^fallback-turn-(\d+)$/;
  const supportedDil=new Set(["text","title","bold","italic","code","caption",
    "table","table-row","table-cell","list","list-item","blockquote",
    "box","col","row","grid","grid-item","flow","flow-item","divider"]);
  const invalidTags=new Set(["IMG","VIDEO","AUDIO","CANVAS","IFRAME",
    "BUTTON","INPUT","TEXTAREA","SELECT","MATH","SVG"]);
  const idFormat=/^[a-f\d-]{36}$/i;

  function scrollAtEnd(lastTurn,wholeThreadVisible){
    // The virtualizer may hold later turns in a bottom spacer. Only trust
    // rendered content when the actual thread scroll container is at its end.
    let node=lastTurn;
    while(node){
      if(node.scrollHeight>node.clientHeight+24&&node.clientHeight>0){
        const style=typeof getComputedStyle==="function"?getComputedStyle(node):null;
        if(style&&/auto|scroll/.test(style.overflowY))
          return node.scrollHeight-node.scrollTop-node.clientHeight<=48;
      }
      node=node.parentElement;
    }
    const root=document.scrollingElement;
    if(root&&root.scrollHeight>root.clientHeight+24&&root.clientHeight>0)
      return root.scrollHeight-root.scrollTop-root.clientHeight<=48;
    // If no scroll position can be established, a rendered suffix is not
    // proof of a complete timeline. Only a whole thread from turn zero is
    // safe to use without that signal.
    return wholeThreadVisible;
  }

  function serialize(node){
    if(node.nodeType===3)return node.nodeValue||"";
    if(node.nodeType!==1)return "";
    if(node.hasAttribute("hidden")||node.getAttribute("aria-hidden")==="true"||
       /(?:^|\\s)sr-only(?:\\s|$)/.test(node.getAttribute("class")||""))
      return "";
    const tag=node.tagName;
    if(invalidTags.has(tag)||node.hasAttribute("data-math")||
       node.hasAttribute("data-code-block"))return null;
    const component=node.getAttribute("data-d-component");
    if(component&&!supportedDil.has(component))return null;
    const children=()=> {
      let out="";
      for(const child of node.childNodes){
        const part=serialize(child);
        if(part===null)return null;
        out+=part;
      }
      return out;
    };
    if(tag==="PRE"){
      const code=node.querySelector("code");
      if(!code)return null;
      const language=(code.className||"").match(/language-([\w#+-]+)/)?.[1]||"";
      const text=code.textContent.replace(/\n$/,"");
      const fence="`".repeat(Math.max(3,...(text.match(/`+/g)||[]).map(s=>s.length+1)));
      return fence+language+"\n"+text+"\n"+fence+"\n\n";
    }
    if(tag==="TABLE"){
      const rows=[...node.querySelectorAll("tr")];
      if(!rows.length)return null;
      const lines=[];
      for(let i=0;i<rows.length;i++){
        const cells=[...rows[i].children].filter(x=>["TD","TH"].includes(x.tagName));
        if(!cells.length||cells.some(x=>x.hasAttribute("rowspan")||x.hasAttribute("colspan")))return null;
        const values=[];
        for(const cell of cells){
          const value=childrenFor(cell);
          if(value===null)return null;
          values.push(value.trim().replace(/\s*\n\s*/g," ").replace(/\|/g,"\\|"));
        }
        if(i===0){
          lines.push("| "+values.join(" | ")+" |");
          lines.push("| "+values.map(()=>"---").join(" | ")+" |");
        }else if(values.length!==rows[0].children.length)return null;
        else lines.push("| "+values.join(" | ")+" |");
      }
      return lines.join("\n")+"\n\n";
    }
    const text=children();
    if(text===null)return null;
    if(/^H[1-6]$/.test(tag))return "#".repeat(Number(tag[1]))+" "+text.trim()+"\n\n";
    if(tag==="P")return text.trim()+"\n\n";
    if(tag==="BR")return "\n";
    if(tag==="HR")return "\n---\n\n";
    if(tag==="STRONG"||tag==="B"||node.hasAttribute("data-d-default-strong"))return "**"+text+"**";
    if(tag==="EM"||tag==="I")return "*"+text+"*";
    if(tag==="S"||tag==="DEL")return "~~"+text+"~~";
    if(tag==="CODE")return "`"+text+"`";
    if(tag==="A"){
      const href=node.getAttribute("href");
      if(!href||!/^(https?:|mailto:|\/)/i.test(href))return null;
      return "["+text+"]("+href+")";
    }
    if(tag==="BLOCKQUOTE")return text.trim().split("\n").map(x=>"> "+x).join("\n")+"\n\n";
    if(tag==="UL"||tag==="OL"){
      const ordered=tag==="OL";
      const items=[...node.children].filter(x=>x.tagName==="LI");
      if(!items.length)return null;
      const lines=[];
      for(let i=0;i<items.length;i++){
        const item=childrenFor(items[i]);
        if(item===null)return null;
        const prefix=ordered?String(i+1)+". ":"- ";
        lines.push(prefix+item.trim().replace(/\n\n$/,"").replace(/\n/g,"\n  "));
      }
      return lines.join("\n")+"\n\n";
    }
    if(tag==="LI")return text;
    // ChatGPT's DIL text components frequently use spans for emphasis.
    // Other wrapper elements are layout-only and preserve child order.
    return text;
  }
  function childrenFor(element){
    let result="";
    for(const child of element.childNodes){
      const value=serialize(child);
      if(value===null)return null;
      result+=value;
    }
    return result;
  }
  function entry(unit,role){
    if(role==="user"){
      // User text is displayed verbatim, including authored Markdown. Resource
      // cards and attachments cannot be faithfully recovered from that text.
      if(unit.querySelector('[class*="resource-card"],img,video'))return null;
      const bubble=unit.querySelector('[data-user-message-bubble]');
      if(!bubble||unit.querySelectorAll('[data-user-message-bubble]').length!==1)return null;
      const text=bubble.querySelector('[data-search-result-target]')?.textContent;
      if(typeof text!=="string"||!text.trim())return null;
      return {role,text:text.trim()};
    }
    const content=unit.querySelector('[data-markdown-text-style="assistant-message"]');
    if(!content||unit.querySelectorAll('[data-markdown-text-style="assistant-message"]').length!==1)return null;
    if(!content.querySelector('[data-markdown-copy="contents"]')&&!content.querySelector("p,pre,ul,ol"))
      return null;
    const text=serialize(content);
    if(text===null||!text.trim())return null;
    return {role,text:text.trim().replace(/\n{3,}/g,"\n\n")};
  }
  function messagesForTurn(turn){
    if(turn.querySelector('[data-talvt-turn-state]:not([data-talvt-turn-state="complete"])'))
      return null;
    const units=[...turn.querySelectorAll("[data-chatgpt-search-unit-key]")];
    if(!units.length)return null;
    const messages=[];
    for(const unit of units){
      const key=unit.getAttribute("data-chatgpt-search-unit-key")||"";
      const role=key.endsWith(":user")?"user":key.endsWith(":assistant")?"assistant":null;
      if(!role)continue;
      // Skip progress/commentary units; only the visible final answer has
      // an assistant-message Markdown root.
      if(role==="assistant"&&!unit.querySelector('[data-markdown-text-style="assistant-message"]'))
        continue;
      const item=entry(unit,role);
      if(!item)return null;
      messages.push({role:item.role,text:item.text,unit});
    }
    if(!messages.length||messages.filter(m=>m.role==="user").length>1||
       messages.filter(m=>m.role==="assistant").length>1)return null;
    return messages;
  }
  function read(scope,info){
    if(!["after","before","all"].includes(scope)||!info.button?.isConnected)return null;
    const selectedTurn=info.button.closest("[data-turn-key]");
    if(!selectedTurn)return null;
    const turns=[...document.querySelectorAll("[data-turn-key]")];
    const index=turns.indexOf(selectedTurn);
    if(index<0||!turns.length)return null;
    const positions=turns.map(turn=>{
      const key=turn.querySelector("[data-content-search-turn-key]")?.
        getAttribute("data-content-search-turn-key");
      const match=key?.match(marker);
      return match?Number(match[1]):null;
    });
    if(positions.some(x=>x===null))return null;
    // Check the entire candidate region for missing virtualized turns.
    const start=scope==="after"?index:0;
    const end=scope==="before"?index:turns.length-1;
    if(scope!=="after"&&positions[0]!==0)return null;
    if(scope!=="before"&&!scrollAtEnd(turns[turns.length-1],positions[0]===0))
      return null;
    for(let i=start+1;i<=end;i++)
      if(positions[i]!==positions[i-1]+1)return null;
    const items=[];
    for(let i=start;i<=end;i++){
      const page=messagesForTurn(turns[i]);
      if(!page)return null;
      for(const item of page)items.push({...item,turnIndex:i});
    }
    let boundary=-1;
    if(scope!=="all"){
      const matches=items.map((m,i)=>m.turnIndex===index&&m.role===info.role?i:-1)
        .filter(i=>i>=0);
      if(matches.length!==1)return null;
      boundary=matches[0];
      // Require the selected button to belong to the same rendered turn.
      if(info.button.closest("[data-turn-key]")!==turns[index])return null;
    }
    const selected=scope==="all"?items:
      scope==="after"?items.slice(boundary):items.slice(0,boundary+1);
    if(!selected.length)return null;
    return selected.map(item=>"## "+(item.role==="user"?"User":"Assistant")+
      "\n\n"+item.text).join("\n\n---\n\n");
  }
  globalThis.GPTTweaksEnhancedCopyLocal=Object.freeze({read});
})();