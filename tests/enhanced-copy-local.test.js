"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const local=fs.readFileSync(path.join(__dirname,"../utilities/enhanced-copy/local.js"),"utf8");

class Node{
  constructor(tag="div",attrs={},children=[]){
    this.nodeType=1;
    this.tagName=tag.toUpperCase();
    this.attributes={...attrs};
    this.childNodes=[];
    this.parentElement=null;
    this.scrollHeight=0;this.clientHeight=0;this.scrollTop=0;
    for(const child of children)this.append(child);
  }
  append(child){child.parentElement=this;this.childNodes.push(child);return this;}
  get children(){return this.childNodes.filter(n=>n.nodeType===1);}
  get textContent(){return this.childNodes.map(n=>n.textContent).join("");}
  getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;}
  hasAttribute(k){return Object.hasOwn(this.attributes,k);}
  matches(selector){
    if(selector==="[data-talvt-turn-state]:not([data-talvt-turn-state=\"complete\"])")
      return this.hasAttribute("data-talvt-turn-state")&&
        this.getAttribute("data-talvt-turn-state")!=="complete";
    if(selector.startsWith("[")){
      const contains=selector.match(/^\[([^\]]+)\*=\"([^\"]+)\"\]$/);
      if(contains)return (this.getAttribute(contains[1])||"").includes(contains[2]);
      const eq=selector.match(/^\[([^=\]]+)=\"([^\"]+)\"\]$/);
      if(eq)return this.getAttribute(eq[1])===eq[2];
      const attr=selector.match(/^\[([^\]]+)\]$/);
      if(attr)return this.hasAttribute(attr[1]);
    }
    return selector.toUpperCase()===this.tagName;
  }
  querySelectorAll(selector){
    const terms=selector.split(",").map(x=>x.trim());
    const found=[];
    const visit=n=>{
      for(const child of n.children){
        if(terms.some(term=>child.matches(term)))found.push(child);
        visit(child);
      }
    };
    visit(this);return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){
    for(let el=this;el;el=el.parentElement)
      if(el.matches(selector))return el;
    return null;
  }
}
function text(value){return {nodeType:3,nodeValue:value,textContent:value,parentElement:null};}
function node(tag,attrs={},...children){return new Node(tag,attrs,children);}
const uuid=n=>n.toString(16).padStart(8,"0")+"-2222-3333-4444-555555555555";
function makeTurn(n,userText,assistantText,{state="complete",rich=false,staticIcon=false}={}){
  const userUnit=node("div",{"data-chatgpt-search-unit-key":"fallback-turn-"+n+":0:user",
    "data-chatgpt-search-message-ids":uuid(n*2)});
  const bubble=node("div",{"data-user-message-bubble":"true"},
    node("div",{"data-search-result-target":""},text(userText)));
  userUnit.append(bubble);
  const assistantUnit=node("div",{"data-chatgpt-search-unit-key":"fallback-turn-"+n+":1:assistant",
    "data-chatgpt-search-message-ids":uuid(n*2+1)});
  const markdown=node("div",{"data-markdown-text-style":"assistant-message"},
    node("div",{"data-markdown-copy":"contents"},
      node("p",{},text("Answer: "),node("strong",{},text(assistantText)))));
  if(rich)markdown.append(node("button",{},text("Interactive content")));
  if(staticIcon)markdown.append(node("svg",{"data-d-component":"icon"}));
  assistantUnit.append(markdown);
  const button=node("button",{"aria-label":"Copy"});
  assistantUnit.append(button);
  const body=node("div",{"data-content-search-turn-key":"fallback-turn-"+n},
    node("div",{"data-talvt-turn-state":state},userUnit,assistantUnit));
  const turn=node("div",{"data-turn-key":uuid(n)},body);
  return {turn,button,userUnit,assistantUnit};
}
function context(numbers,options={}){
  const turns=numbers.map(n=>makeTurn(n,"Question "+n,"**bold "+n+"**",
    {state:options.incomplete===n?"streaming":"complete",rich:options.rich===n,
      staticIcon:options.staticIcon===n}));
  const root=node("main",{},...turns.map(t=>t.turn));
  const scrolling=options.unknownScroll?null:{scrollHeight:2000,clientHeight:500,
    scrollTop:options.notAtEnd?200:1500};
  const document={querySelectorAll:s=>root.querySelectorAll(s),
    scrollingElement:scrolling};
  const scope={globalThis:{},document};
  vm.runInNewContext(local,scope);
  return {turns,read:scope.globalThis.GPTTweaksEnhancedCopyLocal.read,
    info:(idx,role="assistant")=>({
      button:Object.assign(turns[idx].button,{isConnected:true}),
      role,
      messageIds:[uuid(numbers[idx]*2+1)],turnKey:uuid(numbers[idx])
    })};
}
const recent=context([48,49,50]);
const suffix=recent.read("after",recent.info(1));
assert.ok(suffix,"recent selected assistant range must be available locally");
assert.equal((suffix.match(/## (User|Assistant)/g)||[]).length,3,
  "selected assistant, subsequent user and assistant are the complete suffix");
assert.doesNotMatch(suffix,/Question 49|Answer:.*48/);
assert.match(suffix,/Answer: \*\*\*\*bold 49\*\*\*\*|Answer: \*\*bold 49\*\*/);
assert.match(suffix,/Question 50/);
assert.match(suffix,/Answer: \*\*\*\*bold 50\*\*\*\*|Answer: \*\*bold 50\*\*/);
const hole=context([48,50]);
assert.equal(hole.read("after",hole.info(0)),null,"virtualized gap triggers backend fallback");
const notEnd=context([48,49,50],{notAtEnd:true});
assert.equal(notEnd.read("after",notEnd.info(1)),null,"unloaded tail triggers fallback");
const unknown=context([48,49,50],{unknownScroll:true});
assert.equal(unknown.read("after",unknown.info(1)),null,
  "missing scroll-end evidence cannot yield an incomplete suffix");
const small=context([0,1,2],{unknownScroll:true});
assert.ok(small.read("after",small.info(1)),
  "a fully rendered short thread does not require an artificial scrollbar");
const incomplete=context([48,49,50],{incomplete:50});
assert.equal(incomplete.read("after",incomplete.info(1)),null,"streaming final response triggers fallback");
const noStatus=context([48,49,50]);
const finalStatus=noStatus.turns[2].turn.querySelector("[data-talvt-turn-state]");
delete finalStatus.attributes["data-talvt-turn-state"];
assert.equal(noStatus.read("after",noStatus.info(1)),null,
  "a missing completion marker must not copy a possibly partial response");
const iconCase=context([48,49,50],{staticIcon:50});
const iconText=iconCase.read("after",iconCase.info(1));
assert.ok(iconText,"static DIL icon does not force a history request");
assert.match(iconText,/\[Icon\]/,
  "non-text icons are represented explicitly rather than silently dropped");
const rich=context([48,49,50],{rich:50});
assert.equal(rich.read("after",rich.info(1)),null,"interactive content triggers fallback");
assert.equal(recent.read("all",recent.info(1)),null,
  "short visible tail does not prove full conversation");
assert.equal(recent.read("before",recent.info(1)),null,
  "short visible tail does not prove conversation beginning");
const entire=context([0,1,2]);
assert.equal((entire.read("all",entire.info(1)).match(/## (User|Assistant)/g)||[]).length,6);
assert.equal((entire.read("before",entire.info(1)).match(/## (User|Assistant)/g)||[]).length,4);
console.log("PASS: local suffix, no DOM gaps, scroll-end proof, incomplete/rich fallback, full/prefix bounds");
