'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const listeners=[];
const saved={};
const pending={};
const chrome={
  runtime:{id:'extension',onMessage:{addListener:fn=>listeners.push(fn)}},
  storage:{
    local:{get:async()=>({...saved})},
    session:{
      get:async key=>({[key]:pending[key]}),
      set:async data=>Object.assign(pending,data),
      remove:async key=>{delete pending[key]}
    }
  }
};
vm.runInNewContext(read('chrome/session-handoff-bridge.js'),{chrome,URL,Number,Date,String,Error});
async function request(action,data={},sender={}){
  return new Promise(resolve=>{
    const registered=listeners[0](
      {type:'gpt-tweaks:handoff',action,...data},
      {id:'extension',tab:{id:7},url:'https://chatgpt.com/c/123',...sender},
      resolve
    );
    assert.equal(registered,true);
  });
}
(async()=>{
  const text='# Handoff\n'+ 'context '.repeat(16);
  assert.equal((await request('status')).enabled,true);
  let response=await request('prepare',{pathname:'/g/g-p-test/c/123',text});
  assert.equal(response.target,'/g/g-p-test/project');
  assert.equal((await request('read',{pathname:'/'})).pending,false);
  assert.equal((await request('read',{pathname:'/g/g-p-test/project'})).text,text);
  assert.equal((await request('complete',{pathname:'/'})).pending,false);
  assert.equal((await request('complete',{pathname:'/g/g-p-test/project'})).ok,true);
  assert.equal((await request('read',{pathname:'/g/g-p-test/project'})).pending,false);
  response=await request('prepare',{pathname:'/c/123',text});
  assert.equal(response.target,'/');
  assert.equal((await request('read',{pathname:'/'})).pending,true);
  assert.equal((await request('status',{}, {id:'other'})).ok,false);
  assert.equal((await request('status',{}, {url:'https://example.com'})).ok,false);
  assert.equal((await request('prepare',{pathname:'/',text:'invalid'})).ok,false);
  saved['gpt-tweaks.handoff.enabled']='false';
  assert.equal((await request('status')).enabled,false);
  assert.equal((await request('prepare',{pathname:'/',text})).ok,false);
  const manifest=JSON.parse(read('manifest.json'));
  const isolated=manifest.content_scripts.find(entry=>
    entry.js?.includes('utilities/session-handoff/index.js'));
  assert.ok(isolated);
  assert.ok(isolated.js.indexOf('utilities/session-handoff/index.js')<
    isolated.js.indexOf('utilities/session-handoff/ui/menu.js'));
  assert.match(read('chrome/background.js'),/session-handoff-bridge\.js/);
  for(const file of [
    'chrome/session-handoff-bridge.js',
    'utilities/session-handoff/index.js',
    'utilities/session-handoff/ui/menu.js'
  ])new vm.Script(read(file),{filename:file});
  console.log('PASS: handoff transfer, routing, settings, authorization and script loading');
})().catch(error=>{console.error(error);process.exitCode=1;});
