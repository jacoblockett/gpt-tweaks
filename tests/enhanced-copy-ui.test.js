'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../utilities/enhanced-copy/index.js'),'utf8');
const bridge=fs.readFileSync(path.join(__dirname,'../chrome/enhanced-copy-bridge.js'),'utf8');
const conversation='11111111-2222-3333-4444-555555555555';
const userId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const assistantId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

class Node {
  constructor(tag='div',attributes={}){
    this.tag=tag;this.attributes={...attributes};this.children=[];
    this.parent=null;this.style={};this.dataset={};this.handlers={};
    this.isConnected=true;this.textContent='';this.value='';
  }
  setAttribute(k,v){this.attributes[k]=v;}
  getAttribute(k){return this.attributes[k]||null;}
  matches(selector){
    if(selector==='button')return this.tag==='button';
    if(selector.includes('button[aria-label=')){
      return this.tag==='button'&&['Copy','Copy message'].includes(this.getAttribute('aria-label'));
    }
    return false;
  }
  closest(selector){
    for(let n=this;n;n=n.parent){
      if(selector==='.turn-action-controls'&&n.attributes.class==='turn-action-controls')return n;
      if(selector==='[data-chatgpt-search-unit-key]'&&n.getAttribute('data-chatgpt-search-unit-key'))return n;
      if(selector==='[data-turn-key]'&&n.getAttribute('data-turn-key'))return n;
      if(selector.includes('button[aria-label=')&&n.matches(selector))return n;
    }
    return null;
  }
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);
    this.isConnected=false;this.parent=null;}
  contains(other){for(let n=other;n;n=n.parent)if(n===this)return true;return false;}
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  querySelector(selector){
    const nodes=[];const visit=node=>{for(const n of node.children){nodes.push(n);visit(n)}};
    visit(this);
    if(selector==='button')return nodes.find(n=>n.tag==='button')||null;
    if(selector==='[data-chatgpt-selection-message-id]')
      return nodes.find(n=>n.getAttribute(selector.slice(1,-1)))||null;
    if(selector==='[data-gtg-copy-status]')
      return nodes.find(n=>n.dataset.gtgCopyStatus)||null;
    return null;
  }
  querySelectorAll(selector){
    if(selector==='[role="menuitem"]')return this.children.filter(n=>n.getAttribute('role')==='menuitem');
    return [];
  }
  getBoundingClientRect(){return {left:100,top:100,bottom:120};}
  focus(){active=this;}
  click(){
    const event={target:this,defaultPrevented:false,
      preventDefault(){this.defaultPrevented=true;},
      stopImmediatePropagation(){this.stopped=true;}};
    dispatch('click',event);
    if(!event.stopped){
      for(const fn of this.handlers.click||[])fn(event);
      if(!event.defaultPrevented&&['Copy','Copy message'].includes(this.getAttribute('aria-label')))
        nativeCopies++;
    }
  }
}
let active=null,nativeCopies=0,dispatch=()=>{};
async function scenario(role,isEnabled=true,withMessageId=true){
  const listeners=new Map(),requests=[],writes=[];
  const body=new Node('body');
  const doc={
    body,activeElement:active,
    createElement:tag=>new Node(tag),
    execCommand:()=>true,
    addEventListener:(type,fn)=>
      listeners.set(type,[...(listeners.get(type)||[]),fn]),
    dispatchEvent:event=>{
      if(event.type==='gpt-tweaks:copy:request')requests.push(JSON.parse(event.detail));
      for(const fn of listeners.get(event.type)||[])fn(event);
    }
  };
  dispatch=(type,event)=>{for(const fn of listeners.get(type)||[])fn(event);};
  class Event {constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  const unit=new Node('div',{
    'data-chatgpt-search-unit-key':'fallback-turn-1:0:'+role,
    'data-chatgpt-search-message-ids':withMessageId?(role==='user'?userId:assistantId):''
  });
  const control=new Node('div',{class:'turn-action-controls'});
  const button=new Node('button',{'aria-label':role==='user'?'Copy message':'Copy'});
  if(role==='assistant'&&withMessageId){
    const selected=new Node('div',{'data-chatgpt-selection-message-id':assistantId});
    unit.append(selected);
  }
  unit.append(control);control.append(button);
  body.append(unit);
  const saved={enabled:isEnabled?'true':'false'};
  let listener;
  const worker={
    runtime:{id:'test-extension',onMessage:{addListener:fn=>{listener=fn;}}},
    storage:{local:{get:async key=>({[key]:saved.enabled})}}
  };
  vm.runInNewContext(bridge,{chrome:worker,URL});
  assert.equal(typeof listener,'function','trusted worker receives preferences requests');
  const chrome={
    runtime:{sendMessage:request=>new Promise(resolve=>{
      assert.equal(listener(request,{
        id:'test-extension',url:'https://chatgpt.com/c/'+conversation,tab:{id:7}
      },resolve),true);
    })},
    storage:{
      local:{get:async()=>{throw Error('Storage access denied by TRUSTED_CONTEXTS');}},
      onChanged:{addListener(){}}
    }
  };
  const window={innerWidth:1000,innerHeight:800,addEventListener(){}};
  const navigator={clipboard:{writeText:async text=>writes.push(text)}};
  vm.runInNewContext(source,{document:doc,window,navigator,chrome,
    location:{pathname:'/c/'+conversation},
    globalThis:{},Event,CustomEvent:Event,crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789012'},
    console});
  await new Promise(resolve=>setTimeout(resolve,0));
  button.click();
  let menu=body.children.find(node=>node.id==='gtg-copy-menu');
  if(!isEnabled){
    assert.equal(menu,undefined,'disabled feature preserves ordinary copy');
    assert.equal(nativeCopies,1);
    nativeCopies=0;
    return;
  }
  assert.ok(menu,'click on '+role+' native copy opens options');
  assert.deepEqual(menu.querySelectorAll('[role="menuitem"]').map(n=>n.textContent),
    ['Copy this message','Copy before this message',
      'Copy after this message','Copy entire chat history']);
  assert.equal(nativeCopies,0,'opening menu suppresses native copy');
  menu.children[0].click();
  assert.equal(nativeCopies,1,'first option reuses native copy');
  button.click();menu=body.children.find(node=>node.id==='gtg-copy-menu');
  menu.children[withMessageId?2:3].click();
  assert.equal(requests.length,1);
  assert.equal(requests[0].scope,withMessageId?'after':'all');
  assert.equal(requests[0].messageId,withMessageId?(role==='user'?userId:assistantId):undefined);
  doc.dispatchEvent(new Event('gpt-tweaks:copy:result',{detail:JSON.stringify({
    id:requests[0].id,ok:true,text:'## User\n\nHello'
  })}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(writes,['## User\n\nHello']);
  assert.ok(!body.children.find(node=>node.id==='gtg-copy-menu'),'menu closes on copy');
  nativeCopies=0;
}
(async()=>{
  await scenario('user');
  await scenario('assistant');
  await scenario('user',false);
  await scenario('user',true,false);
  await scenario('assistant',true,false);
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'),'utf8'));
  assert.ok(manifest.permissions.includes('clipboardWrite'));
  assert.ok(fs.readFileSync(path.join(__dirname,'../chrome/background.js'),'utf8')
    .includes('importScripts("./enhanced-copy-bridge.js");'),
    'worker must import enhanced copy preferences bridge');
  assert.ok(manifest.content_scripts.some(entry=>entry.world==='MAIN'&&
    entry.js.includes('utilities/enhanced-copy/history-bridge.js')));
  assert.ok(manifest.content_scripts.some(entry=>entry.world==='ISOLATED'&&
    entry.js.includes('utilities/enhanced-copy/index.js')&&
    entry.css.includes('utilities/enhanced-copy/ui/menu.css')));
  console.log('PASS: user/assistant interception, native copy, selected range, unanchored whole-history copy, clipboard and manifest');
})().catch(error=>{console.error(error);process.exitCode=1});
