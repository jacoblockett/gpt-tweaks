'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../utilities/new-chat/index.js'),'utf8');

async function scenario(throwMethod) {
  let calls=0;
  let response={ok:true,data:{enabled:true,middle:true,slash:true}};
  const events={};
  const error=new Error('Extension context invalidated.');
  const chrome={runtime:{sendMessage(m){
    calls++;
    if(throwMethod==='sync' || (throwMethod==='open' && m.type==='gpt-tweaks:new-chat:open'))throw error;
    if(throwMethod==='async')return Promise.reject(error);
    return Promise.resolve(response);
  }}};
  const doc={hidden:false,addEventListener(t,fn){events[t]=fn}};
  const win={addEventListener(t,fn){events[t]=fn}};
  const globalThis={};
  const warnings=[];
  vm.runInNewContext(source,{
    chrome,document:doc,window:win,globalThis,location:{pathname:'/c/123'},
    console:{warn(...args){warnings.push(args)}},
    Element:class Element{}
  });
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(warnings.length,0,'expected lifecycle error to be handled silently');
  if(throwMethod==='open'){
    globalThis.GPTTweaksNewChat.activate('slash');
    for(let i=0;i<20;i++)await Promise.resolve();
  }
  const before=calls;
  events.focus();
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(calls,before,'invalidated script must stop retrying the worker');
  assert.equal(warnings.length,0);
  assert.equal(await globalThis.GPTTweaksNewChat.isEnabled('slash'),false);
}
(async()=>{
  await scenario('sync');
  await scenario('async');
  await scenario('open');
  console.log('PASS: extension context invalidation handled for sync and async messages');
})().catch(error=>{console.error(error);process.exitCode=1});
