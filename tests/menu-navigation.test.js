'use strict';
// Exercise the actual shared controller against the two-section plus-menu DOM.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

class Node {
  constructor(tag='div',type=''){
    this.tag=tag;this.type=type;this.parentElement=null;this.children=[];
    this.dataset={};this.attributes={};this.classes=new Set();this.clicks=0;
    this.classList={
      add:(...names)=>names.forEach(n=>this.classes.add(n)),
      remove:(...names)=>names.forEach(n=>this.classes.delete(n)),
      contains:name=>this.classes.has(name)
    };
  }
  get isConnected(){return !!this.parentElement||this.type==='scroll';}
  getClientRects(){return this.isConnected?[{}]:[];}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  removeAttribute(k){delete this.attributes[k];}
  matches(selector){
    if(selector.includes(',')&&selector!==':hover,:focus')
      return selector.split(',').some(s=>this.matches(s.trim()));
    if(selector===':hover,:focus')return false;
    if(selector==='button')return this.tag==='button';
    if(this.tag!=='button')return false;
    if(selector.includes('data-gtg-menu-option'))return this.type==='injected';
    if(selector.includes('data-gtg-slash'))return this.type==='slash';
    if(selector.includes('data-list-navigation-item'))return this.type==='native';
    return false;
  }
  append(...children){for(const n of children){n.parentElement=this;this.children.push(n);}}
  contains(node){for(let n=node;n;n=n.parentElement)if(n===this)return true;return false;}
  closest(selector){
    for(let n=this;n;n=n.parentElement){
      if(selector==='[data-mention-list-scroll-area]'&&n.type==='scroll')return n;
      if(n.matches(selector))return n;
    }
    return null;
  }
  querySelectorAll(selector){
    const found=[];
    const walk=node=>{for(const n of node.children){if(n.matches(selector))found.push(n);walk(n);}};
    walk(this);return found;
  }
  scrollIntoView(){this.scrolled=true;}
  click(){this.clicks++;}
}

const area=new Node('div','scroll'),primary=new Node(),plugins=new Node();
area.append(primary,plugins);
const github=new Node('button','injected'),tokens=new Node('button','injected');
github.dataset.gtgMenuOption='true';github.dataset.gtgUtilityId='github-source';
tokens.dataset.gtgMenuOption='true';tokens.dataset.gtgUtilityId='token-estimator';
const first=[0,1,2].map(i=>new Node('button','native'));
const last=[3,4].map(i=>new Node('button','native'));
for(const row of [...first,...last])row.setAttribute('data-list-navigation-item','true');
primary.append(github,tokens,...first);plugins.append(...last);
first[0].setAttribute('aria-current','true');first[0].classList.add('bg-primary-ghost-hover');
const events={window:{},document:{}},timers=[];
const document={
  documentElement:{},activeElement:null,
  querySelector:sel=>sel.includes('data-gtg-menu-option')?github:null,
  querySelectorAll:sel=>area.querySelectorAll(sel),
  addEventListener:(key,fn)=>(events.document[key]??=[]).push(fn)
};
const window={addEventListener:(key,fn)=>(events.window[key]??=[]).push(fn)};
const fakePlus=()=>({scanMenu(){},styleInjectedMenuRow(){},mountMenuGroup(){},removeMenuGroup(){}});
const fakeSlash=()=>({resetSlash(){},updateSlash(){},hasSlashMatch(){return false;},
  handleDirectEnter(){},ensureConnected(){}});
const world={__gptTweaksPlusMenu:fakePlus,__gptTweaksSlashMenu:fakeSlash};
const src=fs.readFileSync(path.join(__dirname,'../shared/ui/menus/core.js'),'utf8');
vm.runInNewContext(src,{
  window,document,globalThis:world,Element:Node,
  MutationObserver:class{observe(){}},
  setTimeout:fn=>{timers.push(fn);return 1;},clearTimeout(){},console
});
for(const id of ['github-source','token-estimator'])
  world.__gptTweaksMenus.register({
    id,title:id,description:id,command:'/'+id,
    icon:()=>({}),isEnabled:()=>true,activate(){}
  });
for(const fn of timers.splice(0))fn();
const rows=area.querySelectorAll('button[data-gtg-menu-option="true"],button[data-list-navigation-item="true"]');
const selected=()=>rows.find(row=>row.dataset.gtgPlusSelected==='true');
assert.equal(selected(),github,'initial selection must be the first item');
assert.equal(area.dataset.gtgPlusControlled,'true');

function key(value){
  const event={key:value,isComposing:false,altKey:false,metaKey:false,ctrlKey:false,
    defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},
    stopImmediatePropagation(){this.stopped=true}};
  for(const fn of events.window.keydown||[]){fn(event);if(event.stopped)break;}
  return event;
}
function step(direction,want){
  const e=key(direction);
  assert.equal(e.defaultPrevented,true,'plus navigation must never fall through to React');
  assert.equal(selected(),want,'unexpected row after '+direction);
  assert.equal(rows.filter(r=>r.dataset.gtgPlusSelected==='true').length,1);
}
step('ArrowUp',last[1]); // First injected -> absolute last native
step('ArrowDown',github); // Absolute last native -> first injected
for(const row of rows.slice(1))step('ArrowDown',row);
step('ArrowDown',github); // Full-cycle from bottom
for(const row of [...rows.slice(1)].reverse())step('ArrowUp',row);
step('ArrowUp',github); // Full-cycle from second row
// The React-selected native row stays stale throughout; hover and keys use
// our explicitly selected row, including the second injected button.
function hover(row){
  const event={target:row};
  for(const fn of events.document.pointerover||[])fn(event);
  for(const fn of events.document.pointermove||[])fn(event);
  assert.equal(selected(),row,'pointer should select hovered row');
}
hover(github);hover(tokens);hover(first[0]);hover(last[1]);hover(tokens);
assert.equal(first[0].getAttribute('aria-current'),'true');
assert.equal(tokens.dataset.gtgPlusSelected,'true');
key('Enter');assert.equal(tokens.clicks,1);
const css=fs.readFileSync(path.join(__dirname,'../shared/ui/menus/styles.css'),'utf8');
assert(css.includes('[data-gtg-plus-controlled="true"]'));
assert(css.includes('[data-gtg-plus-selected="true"]'));
console.log('PASS: unified plus keyboard wrap, multi-section native menu, and pointer selection');
