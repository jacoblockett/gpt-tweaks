'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../utilities/session-handoff/index.js'),'utf8');

async function scenario(withButton) {
  let draft='',submitted=0,prepared=0,notices=0,navigation=null;
  const replies=[];
  const filename='Session-Handoff.md';
  const handoff='# Session handoff\n'+'Current goal and recent context. '.repeat(8);
  const anchor={
    textContent:filename,isConnected:true,
    getAttribute:key=>key==='href'?'https://chatgpt.com/test/Session-Handoff.md':null
  };
  const submit=()=>{
    submitted++;
    draft='';
    replies.push({isConnected:true,querySelectorAll:()=>[anchor]});
  };
  const button={
    disabled:false,getAttribute:()=>null,getClientRects:()=>[{}],click:submit
  };
  const form={
    querySelector:selector=>
      withButton&&selector==='button[type="submit"]'&&draft?button:null,
    requestSubmit:submit
  };
  class Input {
    get value(){return draft;}
    set value(value){draft=value;}
    focus(){}
    matches(selector){return selector==='textarea,input';}
    closest(selector){return selector==='form'?form:null;}
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
    querySelectorAll:()=>replies,
    querySelector:()=>null,
    createElement:()=>{notices++;throw Error('Unexpected handoff UI');}
  };
  const location={
    pathname:'/g/g-p-example/c/42',
    href:'https://chatgpt.com/g/g-p-example/c/42',
    assign:path=>{navigation=path}
  };
  const warnings=[];
  vm.runInNewContext(source,{
    chrome,document,window:{addEventListener(){}},globalThis:context,
    location,URL,Date,Event,
    setInterval,clearInterval,setTimeout,
    fetch:async()=>({
      ok:true,type:'basic',headers:{get:()=> 'text/markdown'},
      text:async()=>handoff
    }),
    console:{warn:(...args)=>warnings.push(args)}
  });
  await new Promise(resolve=>setTimeout(resolve,10));
  await context.GPTTweaksHandoff.activate('slash');
  assert.equal(submitted,1,'prompt must submit exactly once');
  assert.equal(prepared,1,'file must be transferred exactly once');
  assert.equal(navigation,'/g/g-p-example/project');
  assert.equal(notices,0,'no handoff error UI');
  assert.equal(warnings.length,0);
  assert.equal(draft,'');
}
(async()=>{
  await scenario(true);
  await scenario(false);
  const plus=fs.readFileSync(path.join(__dirname,'../shared/ui/menus/plus.js'),'utf8');
  const slash=fs.readFileSync(path.join(__dirname,'../shared/ui/menus/slash.js'),'utf8');
  assert.match(plus,/localeCompare\(button\.dataset\.gtgMenuTitle/);
  assert.match(slash,/localeCompare\(COMMAND_TITLE/);
  console.log('PASS: handoff submission, form fallback, no added UI, and menu title ordering');
})().catch(error=>{console.error(error);process.exitCode=1;});
