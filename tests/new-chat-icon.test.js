'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../utilities/new-chat/ui/menu.js'),'utf8');
const nodes=[];
const document={createElementNS(ns,tag){
  const node={tag,attrs:{},children:[],setAttribute(k,v){this.attrs[k]=v},append(v){this.children.push(v)}};
  nodes.push(node);return node;
}};
let config;
vm.runInNewContext(src,{
  document,
  globalThis:{
    GPTTweaksNewChat:{isEnabled(){},activate(){}},
    __gptTweaksMenus:{register(c){config=c}}
  }
});
assert(config,'New chat menu registration missing');
for(const size of [16,20]){
  const svg=config.icon(size);
  assert.equal(svg.attrs.viewBox,'0 0 '+size+' '+size);
  assert.equal(svg.children.length,2);
  assert(svg.children[0].attrs.d.startsWith(size===16?'M6.33325 1.88379':'M8.16675 2.50127'));
  assert(svg.children[1].attrs.d.startsWith(size===16?'M10.8948 2.375':'M13.4265 3.10381'));
  assert.equal(svg.children[1].attrs['fill-rule'],'evenodd');
}
console.log('PASS: exact captured native New chat paths used at 16px and 20px');
