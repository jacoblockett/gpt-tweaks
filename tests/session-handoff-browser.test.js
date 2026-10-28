'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../utilities/session-handoff/index.js'),'utf8');

async function scenario(withButton,success=true,method='slash') {
  let draft='',submitted=0,prepared=0,navigation=null,ui=0;
  const listeners=new Map();
  const handoff='# Session Handoff\n'+'Relevant history and constraints. '.repeat(8);
  function dispatch(event) {
    for(const fn of [...(listeners.get(event.type)||[])])fn(event);
  }
  let arm=null;
  const submit=()=>{
    assert.ok(draft.includes('GPT Tweaks session handoff request.'),
      'handoff needs a unique request marker');
    assert.ok(draft.includes('Write the entire handoff in ENGLISH'),
      'handoff must request an English response');
    assert.ok(draft.includes('never exceed 600'),
      'handoff must impose a concise word budget');
    assert.ok(draft.includes('## Last 3 exchanges'),
      'handoff must preserve recent conversation continuity');
    assert.ok(draft.includes('no file, attachment, download link'),
      'handoff must not request generated files');
    submitted++;draft='';
    // MAIN-world stream observer publishes the result after submission.
    queueMicrotask(()=>dispatch({
      type:'gpt-tweaks:handoff:result',
      detail:JSON.stringify(success?
        {id:arm,ok:true,text:handoff}:
        {id:arm,ok:false,error:'No completed handoff text in reply'})
    }));
  };
  const button={disabled:false,getAttribute:()=>null,getClientRects:()=>[1],click:submit};
  const form={
    querySelector:selector=>withButton&&selector==='button[type="submit"]'&&draft?button:null,
    requestSubmit:submit
  };
  class Input {
    get value(){return draft;}
    set value(value){draft=value;}
    focus(){}
    matches(){return true;}
    closest(){return form;}
    dispatchEvent(){}
  }
  const input=new Input();
  const chrome={runtime:{sendMessage:async request=>{
    if(request.action==='status')return {ok:true,enabled:true};
    if(request.action==='read')return {ok:true,pending:false};
    if(request.action==='prepare'){
      prepared++;
      assert.equal(request.text,handoff);
      assert.equal(request.pathname,'/g/g-p-example/c/42');
      return {ok:true,target:'/g/g-p-example/project'};
    }
    throw Error('Unexpected action: '+request.action);
  }}};
  const context={__gptTweaksMenus:{composer:()=>input}};
  const document={
    querySelector:()=>null,
    createElement:()=>{ui++;throw Error('Unexpected handoff UI');},
    addEventListener:(type,fn)=>{
      const current=listeners.get(type)||[];current.push(fn);listeners.set(type,current);
    },
    removeEventListener:(type,fn)=>{
      listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==fn));
    },
    dispatchEvent:event=>{
      if(event.type==='gpt-tweaks:handoff:arm')arm=event.detail;
      dispatch(event);
    }
  };
  const location={
    pathname:'/g/g-p-example/c/42',
    href:'https://chatgpt.com/g/g-p-example/c/42',
    assign:target=>{navigation=target}
  };
  const warnings=[];
  class CustomEvent {constructor(type,options){this.type=type;this.detail=options?.detail;}}
  vm.runInNewContext(source,{
    chrome,document,window:{addEventListener(){}},globalThis:context,
    location,Date,Event,CustomEvent,
    crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789012'},
    setInterval,clearInterval,setTimeout,clearTimeout,
    console:{warn:(...args)=>warnings.push(args)}
  });
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(await context.GPTTweaksHandoff.isEnabled('menu'),true);
  await context.GPTTweaksHandoff.activate(method);
  assert.equal(submitted,1);
  assert.equal(prepared,success?1:0);
  assert.equal(navigation,success?'/g/g-p-example/project':null);
  assert.equal(ui,0,'no error UI');
  assert.equal(warnings.length,success?0:1);
  assert.equal(draft,'');
}
(async()=>{
  await scenario(true);
  await scenario(false);
  await scenario(true,true,'menu');
  await scenario(true,false);
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'),'utf8'));
  assert.ok(manifest.content_scripts.some(entry=>entry.world==='MAIN'&&
    entry.js.includes('utilities/session-handoff/stream-bridge.js')));
  for(const file of ['utilities/session-handoff/index.js','utilities/session-handoff/stream-bridge.js']){
    new vm.Script(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{filename:file});
  }
  console.log('PASS: automatic handoff send, fallback, rejection, no UI, and bridge registration');
})().catch(error=>{console.error(error);process.exitCode=1;});
