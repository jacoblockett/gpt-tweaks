'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../utilities/session-handoff/index.js'),'utf8');
const toastSource=fs.readFileSync(path.join(__dirname,'../utilities/session-handoff/ui/toast.js'),'utf8');

async function scenario(withButton,success=true,method='slash',dismissEarly=false) {
  let draft='',submitted=0,prepared=0,navigation=null,toastsCreated=0;
  const listeners=new Map();
  const handoff='# Session Handoff\n'+'Relevant history and constraints. '.repeat(8);
  function dispatch(event) {
    for(const fn of [...(listeners.get(event.type)||[])])fn(event);
  }
  let arm=null;
  const submit=()=>{
    const toast=document.getElementById('gtg-handoff-toast');
    assert.ok(toast,'handoff toast must be visible before submission');
    assert.equal(toast.children[0].children[0].textContent,'Session handoff in progress');
    assert.equal(toast.children[0].children[1].textContent,
      'Your conversation is being summarized. A new chat will open automatically. Try not to touch anything.');
    if(dismissEarly){
      toast.children[1].click();
      assert.equal(document.getElementById('gtg-handoff-toast'),null,
        'dismissal removes toast without canceling handoff');
    }
    assert.ok(draft.includes('GPT Tweaks session handoff request.'),
      'handoff needs a unique request marker');
    assert.ok(draft.includes('language predominantly used by the USER'),
      'handoff must follow the user\'s conversational language');
    assert.ok(draft.includes('not the language of this instruction'),
      'English prompt must not force English output');
    assert.ok(draft.includes('translated into the user\'s language'),
      'handoff section headings must use the selected language');
    assert.ok(draft.includes('600 English-word-equivalents'),
      'handoff must retain a language-neutral brevity budget');
    assert.ok(!draft.includes('Write the entire handoff in ENGLISH'),
      'handoff must not require English for all users');
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
  class Node {
    constructor(tag){this.tag=tag;this.children=[];this.parent=null;this.attributes={};}
    setAttribute(k,v){this.attributes[k]=v;}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    remove(){if(!this.parent)return;
      this.parent.children=this.parent.children.filter(child=>child!==this);
      this.parent=null;
    }
    addEventListener(name,fn){(this.handlers??={})[name]=fn;}
    click(){this.handlers?.click?.();}
  }
  const body=new Node('body');
  const document={
    body,
    querySelector:()=>null,
    getElementById:id=>body.children.find(child=>child.id===id)||null,
    createElement:tag=>{if(tag==='aside')toastsCreated++;return new Node(tag);},
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
  const sandbox={
    chrome,document,window:{addEventListener(){}},globalThis:context,
    location,Date,Event,CustomEvent,
    crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789012'},
    setInterval,clearInterval,setTimeout,clearTimeout,
    console:{warn:(...args)=>warnings.push(args)}
  };
  vm.runInNewContext(toastSource,sandbox);
  vm.runInNewContext(source,sandbox);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(await context.GPTTweaksHandoff.isEnabled('menu'),true);
  await context.GPTTweaksHandoff.activate(method);
  assert.equal(submitted,1);
  assert.equal(prepared,success?1:0);
  assert.equal(navigation,success?'/g/g-p-example/project':null);
  assert.equal(toastsCreated,1,'exactly one progress toast per handoff');
  assert.equal(document.getElementById('gtg-handoff-toast'),null,
    'toast removed on success or failure');
  assert.equal(warnings.length,success?0:1);
  assert.equal(draft,'');
}
(async()=>{
  await scenario(true);
  await scenario(false);
  await scenario(true,true,'menu');
  await scenario(true,false);
  await scenario(true,true,'slash',true);
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json'),'utf8'));
  assert.ok(manifest.content_scripts.some(entry=>entry.world==='MAIN'&&
    entry.js.includes('utilities/session-handoff/stream-bridge.js')));
  for(const file of ['utilities/session-handoff/index.js',
    'utilities/session-handoff/ui/toast.js','utilities/session-handoff/stream-bridge.js']){
    new vm.Script(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{filename:file});
  }
  console.log('PASS: handoff toast, dismissal, cleanup, automatic send, and bridge registration');
})().catch(error=>{console.error(error);process.exitCode=1;});
