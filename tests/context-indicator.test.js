'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..');
const src=p=>fs.readFileSync(path.join(root,p),'utf8');
class Style {
  constructor(){this.values=new Map();}
  setProperty(k,v,priority=''){this.values.set(k,{value:String(v),priority});}
  getPropertyValue(k){return this.values.get(k)?.value||'';}
  getPropertyPriority(k){return this.values.get(k)?.priority||'';}
  removeProperty(k){this.values.delete(k);}
}
class Element {
  constructor(tag='div',id=''){
    this.tagName=tag;this.id=id;this.style=new Style();this.events={};this.attrs=new Map();
    this.parentElement=null;this.children=[];this.dataset={};this.textContent='';this.hidden=false;
  }
  set innerHTML(value){this.source=value;this.ids=new Map();for(const [,id] of value.matchAll(/id="([^"]+)"/g))this.ids.set(id,new Element('span',id));}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  trigger(name,e={}){for(const fn of this.events[name]||[])fn(e);}
  querySelector(selector){return this.ids?.get(selector.startsWith('#')?selector.slice(1):selector)||null;}
  append(el){this.children.push(el);el.parentElement=this;}
  insertBefore(el,other){this.children.splice(this.children.indexOf(other),0,el);el.parentElement=this;el.nextElementSibling=other;}
  remove(){const p=this.parentElement;if(!p)return;const i=p.children.indexOf(this);if(i>=0)p.children.splice(i,1);this.parentElement=null;}
  get isConnected(){return this.parentElement?.isConnected||false;}
  getBoundingClientRect(){return {top:150,bottom:this.id==='ct-v1-marker'?150:170};}
  setAttribute(k,v){this.attrs.set(k,v);}
  removeAttribute(k){this.attrs.delete(k);}
  hasAttribute(k){return this.attrs.has(k);}
  attachShadow(){const shadow=new Element('shadow');shadow.adoptedStyleSheets=[];shadow.querySelector=selector=>shadow.children[0]?.querySelector(selector);this.append(shadow);return shadow;}
  blur(){this.trigger('blur');}
  focus(){this.trigger('focus');}
}
async function run(){
  const body=new Element('body');Object.defineProperty(body,'isConnected',{get:()=>true});
  const form=new Element('form');body.append(form);
  const layout=new Element('div');form.append(layout);
  const surface=new Element('div');layout.append(surface);
  const composerRoot=new Element('div');surface.append(composerRoot);
  form.querySelector=s=>s==='[data-composer-dark]'?composerRoot:composerRoot;
  const doc={body,documentElement:body,querySelector:s=>s.startsWith('form[')?form:null,querySelectorAll:()=>[],createElement:tag=>new Element(tag)};
  const world={console,document:doc,window:{},globalThis:null,setTimeout,clearTimeout,
    CSSStyleSheet:class{replaceSync(s){this.source=s}},
    MutationObserver:class{observe(){}disconnect(){}},
    getComputedStyle:e=>({display:'flex',borderTopLeftRadius:'28px',backgroundColor:'rgb(43,43,43)',getPropertyValue:k=>''}),
    Intl,Number,Map,Set};world.globalThis=world;
  vm.runInNewContext(src('utilities/context-tracker/tracker-core.js'),world);
  vm.runInNewContext(src('utilities/context-tracker/ui/indicator.js'),world);
  const saves=[];let view;
  let state={activeEntries:[['x',128000,1]],observedEntries:new Map(),streamEntries:new Map(),
    target:512000,complete:true,initialDiscovery:false,lastError:'',flags:{tokens:true,limit:true,percent:true}};
  view=world.GPTTweaksContextIndicator(world.CTCore,async v=>{saves.push(v);state.target=v;view.render(state);return true});
  view.setVisible(true);view.setConversation('12345678-1234-1234-1234-123456789abc');view.render(state);
  const marker=layout.children.find(x=>x.id==='ct-v1-marker');assert(marker);
  const panel=marker.children[0].children[0]; // Shadow root -> panel
  const get=id=>panel.ids.get(id);
  assert(!panel.source.includes('id="messages"'));
  assert.equal(get('used').textContent,'128,000');
  assert.equal(get('target').textContent,'512,000');
  assert.equal(get('percentage').textContent,' (25.0%)');
  assert.equal(get('tokens-label').textContent,''); // static text lives in the DOM, not a render overwrite.
  assert(!panel.events.click); // Clicking the whole tracker never opens settings.
  get('target').focus();get('target').textContent='100,000.7';get('target').blur();
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(saves,[100001]);assert.equal(get('target').textContent,'100,001');
  get('target').focus();get('target').textContent='0';get('target').blur();
  await new Promise(r=>setTimeout(r,10));
  assert.equal(saves.at(-1),1);
  get('target').focus();get('target').textContent='something';get('target').blur();
  assert.equal(get('target').textContent,'1');
  get('target').focus();get('target').textContent='25';get('target').trigger('keydown',{key:'Escape',preventDefault(){}});
  assert.equal(get('target').textContent,'1');
  state.flags={tokens:false,limit:false,percent:true};view.render(state);
  assert.equal(get('used').hidden,true);assert.equal(get('target-wrap').hidden,true);
  assert.equal(get('percentage').hidden,false);
  state.flags={tokens:true,limit:true,percent:false};view.render(state);
  assert.equal(get('used').hidden,false);assert.equal(get('target-wrap').hidden,false);
  assert.equal(get('percentage').hidden,true);
  console.log('PASS: composer horizontal indicator, target rounding/min/persistence, cancel/invalid, display switches, no message count or click-to-settings');
}
run().catch(e=>{console.error(e);process.exit(1)});