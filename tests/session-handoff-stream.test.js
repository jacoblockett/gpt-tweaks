'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../utilities/session-handoff/stream-bridge.js'),'utf8');

async function scenario({complete=true,abort=false,file=false,status='finished_successfully',
  matching=true}={}) {
  const listeners=new Map(),results=[],calls=[];
  const document={
    addEventListener:(name,fn)=>listeners.set(name,[...(listeners.get(name)||[]),fn]),
    dispatchEvent:event=>{
      if(event.type==='gpt-tweaks:handoff:result')results.push(JSON.parse(event.detail));
      for(const fn of listeners.get(event.type)||[])fn(event);
    }
  };
  class CustomEvent {
    constructor(type,{detail}={}){this.type=type;this.detail=detail;}
  }
  const body=file?'[Session-Handoff.md](sandbox:/mnt/data/Session-Handoff.md)':
    '# Session handoff\n\n## Objective\n'+'Keep the project moving with preserved context. '.repeat(5);
  const commentary={id:'commentary-1',author:{role:'assistant'},channel:'commentary',
    recipient:'all',content:{parts:['Preparing response']},end_turn:false};
  const final={id:'final-1',author:{role:'assistant'},channel:'final',
    recipient:'all',content:{parts:['']},end_turn:false,status:'in_progress'};
  const frames=[
    {v:{message:commentary}},
    {v:{message:final}},
    {v:[{p:'/message/content/parts/0',o:'append',v:body.slice(0,50)}]},
    {v:[{p:'/message/content/parts/0',o:'append',v:body.slice(50)}]},
    ...(complete?[{v:[
      {p:'/message/end_turn',o:'replace',v:true},
      {p:'/message/status',o:'replace',v:status}
    ]}]:[])
  ];
  const raw=frames.map(frame=>'event: delta\ndata: '+JSON.stringify(frame)+'\n\n').join('')+
    'data: [DONE]\n\n';
  const bytes=new TextEncoder().encode(raw);
  const chunks=[bytes.slice(0,43),bytes.slice(43,149),bytes.slice(149)];
  const window={fetch:async url=>{
    calls.push(String(url));
    return {
      ok:true,clone:()=>({
        ok:true,headers:{get:()=> 'text/event-stream'},
        body:{getReader:()=>{
          let index=0;
          return {
            read:async()=>{
              if(index<chunks.length)return {done:false,value:chunks[index++]};
              if(abort)throw Object.assign(new Error('signal is aborted without reason'),{name:'AbortError'});
              return {done:true};
            },
            releaseLock(){}
          };
        }}
      })
    };
  }};
  vm.runInNewContext(source,{
    window,document,CustomEvent,URL,Request,TextDecoder,
    location:{href:'https://chatgpt.com/c/123',origin:'https://chatgpt.com',pathname:'/c/123'}
  });
  document.dispatchEvent(new CustomEvent('gpt-tweaks:handoff:arm',{detail:'test123456789012'}));
  await window.fetch('/backend-api/f/conversation',{
    method:'POST',body:JSON.stringify({messages:[
      {id:'user-1',author:{role:'user'},content:{parts:[matching?
        '為本對話製交接文件，供新會話承續。':'ordinary unrelated message']}}
    ]})
  });
  for(let i=0;i<100&&!results.length;i++)await Promise.resolve();
  assert.equal(calls.length,1,'handoff must not make history or download requests');
  if(!matching){assert.equal(results.length,0);return;}
  assert.equal(results.length,1,'handoff reports one result');
  const valid=complete&&status==='finished_successfully'&&!file;
  assert.equal(results[0].ok,valid);
  if(valid)assert.equal(results[0].text,body.trim());
  else assert.ok(results[0].error);
}
(async()=>{
  await scenario();
  await scenario({abort:true});
  await scenario({complete:false});
  await scenario({complete:false,abort:true});
  await scenario({status:'finished_with_error'});
  await scenario({file:true});
  await scenario({matching:false});
  console.log('PASS: streamed Markdown, split deltas, abort handling, final-turn checks, file rejection, no extra requests');
})().catch(error=>{console.error(error);process.exitCode=1;});
