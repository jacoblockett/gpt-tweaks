'use strict';
// The real shared menu coordinator, with React's native arrow behavior modeled
// only for keys the extension intentionally leaves unhandled.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
class Row {
  constructor(kind,id){
    this.kind=kind;this.id=id;this.parentElement=null;
    this.dataset={};this.attributes={};this.classes=new Set();this.clicks=0;
    this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),
      remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),
      contains:x=>this.classes.has(x)};
  }
  matches(selector){
    if(selector.includes(',')&&selector!==':hover,:focus')
      return selector.split(',').some(part=>this.matches(part.trim()));
    if(selector===':hover,:focus')return false;
    if(selector==='button')return true;
    if(selector.includes('data-gtg-menu-option'))return this.kind==='utility';
    if(selector.includes('data-gtg-slash'))return this.kind==='slash';
    if(selector.includes('data-list-navigation-item'))return this.kind==='native';
    return false;
  }
  get isConnected(){return this.parentElement!==null;}
  getClientRects(){return [{height:40}];}
  getAttribute(name){return this.attributes[name]??null;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  click(){this.clicks++;}
}
function scenario(kind,splitSections=false) {
  const utilities=[new Row(kind,'github-source'),new Row(kind,'token-estimator')];
  for(let i=0;i<utilities.length;i++){
    utilities[i].dataset.gtgUtilityId=utilities[i].id;
    if(kind==='utility')utilities[i].dataset.gtgMenuOption='true';
    else utilities[i].dataset.gtgSlash='true';
  }
  const natives=Array.from({length:splitSections?5:3},(_,i)=>
    new Row('native','native-'+i));
  const section={children:[...utilities,...natives.slice(0,3)]};
  const plugins={children:splitSections?natives.slice(3):[]};
  // Match ChatGPT's real plus-menu structure: primary and plugin sections
  // share a scroll area, but injected rows are only in the primary section.
  const scrollArea={querySelectorAll:()=>natives};
  section.querySelectorAll=selector=>section.children.filter(row=>
    selector.includes('data-list-navigation-item')&&row.kind==='native');
  section.closest=selector=>splitSections&&selector==='[data-mention-list-scroll-area]'?scrollArea:null;
  for(const row of section.children)row.parentElement=section;
  for(const row of plugins.children)row.parentElement=plugins;
  const eventHandlers=new Map();
  const document={
    documentElement:{},activeElement:null,
    querySelectorAll(selector){
      return selector.includes('data-gtg-menu-option')?
        section.children.filter(row=>row.kind==='utility'||row.kind==='slash'):[];
    },
    addEventListener(){},getElementById(){return null}
  };
  const window={addEventListener(name,listener){
    const listeners=eventHandlers.get(name)||[];
    listeners.push(listener);eventHandlers.set(name,listeners);
  }};
  const plus=()=>({scanMenu(){},styleInjectedMenuRow(){},mountMenuGroup(){},removeMenuGroup(){}});
  const slash=()=>({resetSlash(){},updateSlash(){},hasSlashMatch(){return false;},
    handleDirectEnter(){},ensureConnected(){}});
  const world={__gptTweaksPlusMenu:plus,__gptTweaksSlashMenu:slash};
  const src=fs.readFileSync(path.join(__dirname,'../shared/ui/menus/core.js'),'utf8');
  vm.runInNewContext(src,{
    window,document,globalThis:world,
    MutationObserver:class{observe(){}},setTimeout:()=>1,clearTimeout:()=>{},console
  });
  for(const id of ['github-source','token-estimator']){
    world.__gptTweaksMenus.register({
      id,title:id,description:id,command:'/'+id,
      icon:()=>({}),isEnabled:()=>true,activate(){}
    });
  }
  function nativeAt(index){
    natives.forEach((row,i)=>{
      if(i===index)row.setAttribute('aria-current','true');
      else row.removeAttribute('aria-current');
    });
  }
  function selected(){
    return utilities.find(row=>row.dataset.gtgVirtualHighlight==='true')?.id||
      natives.find(row=>row.getAttribute('aria-current')==='true')?.id;
  }
  function press(key){
    const event={key,defaultPrevented:false,isComposing:false,altKey:false,
      metaKey:false,ctrlKey:false,
      preventDefault(){this.defaultPrevented=true;},
      stopImmediatePropagation(){this.stopped=true;}};
    for(const listener of eventHandlers.get('keydown')||[]){
      listener(event);
      if(event.stopped)break;
    }
    if(!event.defaultPrevented&&(key==='ArrowUp'||key==='ArrowDown')&&natives.length){
      const i=natives.findIndex(row=>row.getAttribute('aria-current')==='true');
      nativeAt((i+(key==='ArrowDown'?1:-1)+natives.length)%natives.length);
    }
    return event;
  }
  function step(key,target,intercepted){
    const event=press(key);
    assert.equal(selected(),target,kind+': '+key+' should select '+target);
    assert.equal(event.defaultPrevented,intercepted,kind+': '+key+' interception');
  }
  nativeAt(0);
  step('ArrowUp','token-estimator',true);
  step('ArrowUp','github-source',true);
  step('ArrowUp',natives[natives.length-1].id,false);
  step('ArrowDown','github-source',true);
  step('ArrowDown','token-estimator',true);
  step('ArrowDown','native-0',false);
  step('ArrowUp','token-estimator',true);
  step('ArrowDown','native-0',true);
  nativeAt(natives.length-1);
  // The final plugin item must wrap to the first injected utility, not
  // the first React-managed native item.
  step('ArrowDown','github-source',true);
  step('ArrowUp',natives[natives.length-1].id,true);
  nativeAt(0);
  step('ArrowUp','token-estimator',true);
  step('ArrowUp','github-source',true);
  step('ArrowDown','token-estimator',true);
  // A command fallback with only injected rows wraps within that list.
  section.children=[...utilities];
  natives.forEach(row=>{row.parentElement=null;});
  step('ArrowDown','github-source',true);
  step('ArrowUp','token-estimator',true);
  press('Enter');
  assert.equal(utilities[1].clicks,1);
}
scenario('utility');
scenario('utility',true); // Plus menu with separate primary and plugin sections.
scenario('slash');
console.log('PASS: combined wraparound, real multi-section plus-menu bottom, slash and fallback');
