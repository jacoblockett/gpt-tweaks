'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../utilities/new-chat/ui/tooltip.js'),'utf8');
const children=[];
const row={
  tagName:'DIV',textContent:'New chat',
  classList:{values:[],add(...x){this.values.push(...x)}},
  append(el){children.push(el);this.textContent+=' '+el.textContent}
};
const tooltip={
  getAttribute:n=>n==='role'?'tooltip':null,
  querySelector:n=>n==='kbd'?children[0]||null:null,
  get textContent(){return row.textContent},
  firstElementChild:row
};
const button={getAttribute:n=>n==='aria-describedby'?'tip':null};
const doc={
  documentElement:{},addEventListener(){},
  querySelectorAll(){return [button]},
  getElementById:id=>id==='tip'?tooltip:null,
  createElement(tag){return {tagName:tag.toUpperCase(),className:'',textContent:''}}
};
let callback;
class MutationObserver{constructor(fn){callback=fn}observe(){}}
vm.runInNewContext(src,{document:doc,MutationObserver});
assert.equal(children.length,1);
assert.equal(children[0].tagName,'KBD');
assert.equal(children[0].textContent,'Ctrl+Shift+O');
assert(children[0].className.includes('color-background-tooltip-shortcut'));
assert(row.classList.values.includes('flex'));
callback();
assert.equal(children.length,1,'do not duplicate the existing shortcut');
console.log('PASS: existing native tooltip augmented without duplicates');
