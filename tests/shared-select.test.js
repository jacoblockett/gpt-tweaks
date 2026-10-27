'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
class Node {
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners={};this.attributes={};this.hidden=true;this.textContent='';this.disabled=false;this.value='';}
  addEventListener(n,fn){(this.listeners[n]??=[]).push(fn)}
  dispatchEvent(e){for(const fn of this.listeners[e.type]||[])fn(e);return true}
  trigger(n,e={}){for(const fn of this.listeners[n]||[])fn(e)}
  append(node){this.children.push(node);node.parentElement=this;}
  replaceChildren(...nodes){this.children=[];nodes.forEach(n=>this.append(n));}
  querySelector(sel){return sel==='span'?this.children.find(n=>n.tag==='span'):null}
  querySelectorAll(){return this.children.filter(n=>n.attributes.role==='option')}
  setAttribute(k,v){this.attributes[k]=v}
  getAttribute(k){return this.attributes[k]}
  focus(){world.document.activeElement=this}
  click(){this.trigger('click')}
  contains(el){return el===this || this.children.some(n=>n.contains(el))}
}
const world={document:{createElement:tag=>new Node(tag),addEventListener(){},activeElement:null},Event:class {constructor(type){this.type=type}},globalThis:null};world.globalThis=world;
const source=fs.readFileSync(path.join(__dirname,'../shared/ui/select.js'),'utf8');
vm.runInNewContext(source,world);
const select=new Node('select'),trigger=new Node('button'),list=new Node('div');
trigger.append(new Node('span'));
const initial=[{textContent:'New tab',value:'tab'},{textContent:'New window',value:'window'}];
select.options=initial;select.selectedOptions=[initial[0]];select.value='tab';
select.addEventListener('change',()=>{select.selectedOptions=initial.filter(x=>x.value===select.value)});
let changes=0;select.addEventListener('change',()=>changes++);
const ui=world.GPTTweaksSelect(select,trigger,list);
assert.equal(trigger.querySelector('span').textContent,'New tab');
trigger.click();assert.equal(list.hidden,false);assert.equal(list.children.length,2);
list.children[1].click();assert.equal(select.value,'window');assert.equal(changes,1);
assert.equal(trigger.querySelector('span').textContent,'New window');assert.equal(list.hidden,true);
trigger.click();list.onkeydown({key:'Escape',preventDefault(){}});
assert.equal(list.hidden,true);
select.disabled=true;ui.sync();assert.equal(trigger.disabled,true);
assert.equal(source.includes('gtg-revision-option'),false);
console.log('PASS: shared select trigger, options, change event, Escape, disable state');