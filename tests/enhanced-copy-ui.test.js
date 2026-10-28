'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../utilities/enhanced-copy/index.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'),'utf8'));
const conversation='11111111-2222-3333-4444-555555555555';

class TextNode{
  constructor(text){this.nodeType=3;this.nodeValue=text;this.parentElement=null;}
  get textContent(){return this.nodeValue;}
  cloneNode(){return new TextNode(this.nodeValue);}
}
class Node{
  constructor(tag='div',attrs={}){
    this.nodeType=1;this.tagName=tag.toUpperCase();this.attrs={...attrs};
    this.childNodes=[];this.parentElement=null;this.dataset={};this.style={};
    this.events=new Map();this.id=attrs.id||'';this.tabIndex=-1;
  }
  get children(){return this.childNodes.filter(x=>x.nodeType===1);}
  get className(){return this.getAttribute('class')||'';}
  set className(v){this.setAttribute('class',v);}
  get textContent(){return this.childNodes.map(x=>x.textContent).join('');}
  set textContent(v){this.childNodes=[new TextNode(v)];}
  getAttribute(name){return name==='id'?this.id:(this.attrs[name]??null);}
  setAttribute(name,value){this.attrs[name]=String(value);if(name==='id')this.id=String(value);}
  removeAttribute(name){delete this.attrs[name];if(name==='id')this.id='';}
  hasAttribute(name){return this.getAttribute(name)!==null;}
  matches(selector){
    if(selector==='[role="menu"]'||selector==='[role="menuitem"]')
      return this.getAttribute('role')===selector.match(/"([^"]+)"/)[1];
    if(selector==='[data-gtg-copy-entire]')return this.hasAttribute('data-gtg-copy-entire');
    if(selector==='[data-gtg-copy-icon]')return this.hasAttribute('data-gtg-copy-icon');
    if(selector==='[id]')return !!this.id;
    if(selector==='svg')return this.tagName==='SVG';
    if(selector==='.gtg-copy-toast-icon'||selector==='.gtg-copy-toast-label')
      return (this.getAttribute('class')||'').split(/\s+/).includes(selector.slice(1));
    if(selector.startsWith('[data-app-shell-main-titlebar] button')){
      return this.tagName==='BUTTON'&&this.getAttribute('aria-label')==='More'&&
        this.getAttribute('aria-haspopup')==='menu'&&
        !!this.closest('[data-app-shell-main-titlebar]');
    }
    if(selector==='[data-app-shell-main-titlebar]')
      return this.hasAttribute('data-app-shell-main-titlebar');
    return false;
  }
  closest(selector){for(let n=this;n;n=n.parentElement)if(n.matches(selector))return n;return null;}
  querySelectorAll(selector){
    const result=[];
    const scan=node=>{for(const child of node.children){if(child.matches(selector))result.push(child);scan(child);}};
    scan(this);return result;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.childNodes.push(n);}}
  insertBefore(node,other){const i=this.childNodes.indexOf(other);assert.ok(i>=0);node.parentElement=this;this.childNodes.splice(i,0,node);}
  remove(){const p=this.parentElement;if(p)p.childNodes=p.childNodes.filter(x=>x!==this);this.parentElement=null;}
  replaceWith(other){const p=this.parentElement;const i=p.childNodes.indexOf(this);p.childNodes[i]=other;other.parentElement=p;this.parentElement=null;}
  replaceChildren(...nodes){this.childNodes=[];this.append(...nodes);}
  cloneNode(deep){
    const n=new Node(this.tagName,this.attrs);
    n.dataset={...this.dataset};n.id=this.id;
    if(deep)for(const child of this.childNodes)n.append(child.cloneNode(true));
    return n;
  }
  addEventListener(type,fn){this.events.set(type,[...(this.events.get(type)||[]),fn]);}
  dispatchEvent(event){event.target??=this;for(const fn of this.events.get(event.type)||[])fn(event);return true;}
  focus(){}
}
class Event{
  constructor(type,options={}){this.type=type;Object.assign(this,options);}
  preventDefault(){this.defaultPrevented=true;}
  stopPropagation(){this.propagationStopped=true;}
}
class KeyboardEvent extends Event{}
class MutationObserver{
  constructor(fn){this.fn=fn;this.active=false;MutationObserver.instances.push(this);}
  observe(){this.active=true;}
  disconnect(){this.active=false;}
  static notify(){for(const m of MutationObserver.instances)if(m.active)m.fn();}
}
MutationObserver.instances=[];

async function scenario({enabled=true,mode='success'}={}){
  let now=0,timerId=0;
  const timers=new Map();
  const schedule=(fn,ms)=>{const id=++timerId;timers.set(id,{at:now+ms,fn});return id;};
  const clear=id=>timers.delete(id);
  const advance=ms=>{
    const until=now+ms;
    while(true){
      const next=[...timers].filter(([,item])=>item.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;
      now=next[1].at;timers.delete(next[0]);next[1].fn();
    }
    now=until;
  };
  const body=new Node('body');
  const header=new Node('div',{'data-app-shell-main-titlebar':''});
  const trigger=new Node('button',{
    'aria-label':'More','aria-haspopup':'menu','aria-expanded':'false','aria-controls':'header-menu',id:'header-trigger'
  });
  header.append(trigger);body.append(header);
  let nativeCopies=0;
  const native=new Node('button',{'aria-label':'Copy'});
  native.addEventListener('click',()=>nativeCopies++);
  body.append(native);
  const events=new Map(),requests=[],cancellations=[],writes=[];
  const document={
    body,
    createElement:tag=>new Node(tag),
    createElementNS:(_ns,tag)=>new Node(tag),
    addEventListener:(type,fn)=>events.set(type,[...(events.get(type)||[]),fn]),
    dispatchEvent:event=>{
      if(event.type==='gpt-tweaks:copy:request')requests.push(JSON.parse(event.detail));
      if(event.type==='gpt-tweaks:copy:cancel')cancellations.push(event.detail);
      for(const fn of events.get(event.type)||[])fn(event);
    },
    querySelectorAll:sel=>body.querySelectorAll(sel)
  };
  const window={addEventListener(){},navigation:{addEventListener(){}}};
  const chrome={runtime:{sendMessage:async()=>({ok:true,enabled})},
    storage:{onChanged:{addListener(){}}}};
  const navigator={clipboard:{writeText:async text=>{
    if(mode==='clipboard-error')throw Error('Clipboard unavailable');
    writes.push(text);
  }}};
  const location={pathname:'/c/'+conversation};
  vm.runInNewContext(source,{
    document,window,chrome,MutationObserver,KeyboardEvent,CustomEvent:Event,
    navigator,location,crypto:{randomUUID:()=> 'abcd1234-aaaa-bbbb-cccc-123456789abc'},
    setTimeout:schedule,clearTimeout:clear,console
  });
  await Promise.resolve();
  // A regular native copy action is never intercepted.
  native.dispatchEvent(new Event('click'));
  assert.equal(nativeCopies,1,'message copy remains native');
  assert.equal(requests.length,0,'message copy makes no Enhanced Copy request');
  const item=label=>new Node('div',{role:'menuitem'});
  function openMenu(){
    document.dispatchEvent(new Event('pointerdown',{target:trigger}));
    trigger.setAttribute('aria-expanded','true');
    const menu=new Node('div',{role:'menu',id:'header-menu'});
    const archive=item('Archive');
    const span=new Node('span');
    span.append(new TextNode('Archive'));
    archive.append(new Node('svg'),span);
    const remove=item('Delete');remove.append(new TextNode('Delete'));
    menu.append(archive,remove);body.append(menu);
    MutationObserver.notify();
    return {menu,archive,remove};
  }
  const {menu,archive,remove}=openMenu();
  const actions=menu.querySelectorAll('[role="menuitem"]');
  if(!enabled){
    assert.equal(actions.length,2,'disabled utility leaves the native menu unchanged');
    return;
  }
  assert.equal(actions.length,3,'one copy action inserted in native menu');
  assert.equal(actions[0].getAttribute('aria-label'),'Copy Entire Chat');
  assert.equal(actions[1],archive,'copy is adjacent to Archive');
  assert.equal(actions[2],remove,'Delete remains in native group');
  assert.equal(actions[0].textContent,'Copy Entire Chat');
  assert.equal(menu.querySelectorAll('[data-gtg-copy-entire]').length,1);
  MutationObserver.notify();
  assert.equal(menu.querySelectorAll('[data-gtg-copy-entire]').length,1,'no duplicate injection');
  actions[0].dispatchEvent(new Event('click'));
  assert.equal(requests.length,1);
  assert.equal(requests[0].scope,'all');
  assert.equal(requests[0].conversationId,conversation);
  assert.equal(requests[0].messageIds,undefined,'no selected message needed');
  const toast=body.querySelector('#gtg-copy-toast')||body.children.find(x=>x.id==='gtg-copy-toast');
  assert.ok(toast,'loading toast appears immediately');
  assert.equal(toast.dataset.state,'loading');
  assert.equal(toast.querySelector('.gtg-copy-toast-label').textContent,'Loading entire chat history');
  assert.equal(toast.querySelector('[data-gtg-copy-icon]')?.getAttribute('data-gtg-copy-icon'),'loading');
  advance(10000);
  assert.equal(body.children.includes(toast),true,'loading toast does not auto-dismiss');
  if(mode==='error'){
    document.dispatchEvent(new Event('gpt-tweaks:copy:result',{
      detail:JSON.stringify({id:requests[0].id,ok:false,error:'HTTP 404'})
    }));
    assert.equal(toast.dataset.state,'error');
    assert.equal(writes.length,0,'no clipboard write on error');
    advance(4999);assert.ok(body.children.includes(toast));
    advance(1);assert.ok(!body.children.includes(toast));
    return;
  }
  document.dispatchEvent(new Event('gpt-tweaks:copy:result',{
    detail:JSON.stringify({id:requests[0].id,ok:true,text:'## User\n\nHello'})
  }));
  await Promise.resolve();await Promise.resolve();
  if(mode==='clipboard-error'){
    assert.equal(toast.dataset.state,'error');
    assert.deepEqual(writes,[]);
    return;
  }
  assert.deepEqual(writes,['## User\n\nHello']);
  assert.equal(toast.dataset.state,'copied');
  assert.equal(toast.querySelector('.gtg-copy-toast-label').textContent,'Copied');
  assert.equal(toast.querySelector('[data-gtg-copy-icon]')?.getAttribute('data-gtg-copy-icon'),'copied');
  advance(2999);assert.ok(body.children.includes(toast));
  advance(1);assert.ok(!body.children.includes(toast),'success toast dismissed after three seconds');
}

(async()=>{
  await scenario();
  await scenario({enabled:false});
  await scenario({mode:'error'});
  await scenario({mode:'clipboard-error'});
  assert.ok(manifest.permissions.includes('clipboardWrite'));
  assert.ok(fs.readFileSync(path.join(__dirname,'../chrome/background.js'),'utf8')
    .includes('importScripts("./enhanced-copy-bridge.js");'));
  const main=manifest.content_scripts.find(entry=>entry.world==='MAIN');
  assert.ok(main.js.includes('utilities/enhanced-copy/history-bridge.js'));
  const isolated=manifest.content_scripts.find(entry=>entry.world==='ISOLATED'&&
    entry.js.includes('utilities/enhanced-copy/index.js'));
  assert.ok(isolated);
  assert.ok(!isolated.js.includes('utilities/enhanced-copy/local.js'));
  assert.ok(isolated.css.includes('utilities/enhanced-copy/ui/menu.css'));
  assert.ok(!source.includes('button[aria-label="Copy"]'));
  console.log('PASS: native copy untouched, header action injection, on-demand history, persistent toast and clipboard states');
})().catch(error=>{console.error(error);process.exitCode=1});
