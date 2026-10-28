'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../utilities/session-handoff/stream-bridge.js'),'utf8');
class URLMock {
  constructor(raw){
    this.base=raw.startsWith('/')?'https://chatgpt.com'+raw:raw;
    this.origin='https://chatgpt.com';this.protocol='https:';
    this.pathname=this.base.replace(/^https:\/\/[^/]+/,'').split('?')[0];
    this.searchParams=new ParamsMock();
  }
  get href(){const p=this.searchParams.toString();return this.base+(p?(this.base.includes('?')?'&':'?')+p:'');}
}
class HeadersMock {
  constructor(input={}){this.values=new Map(input instanceof HeadersMock?input.values:Object.entries(input).map(([k,v])=>[k.toLowerCase(),v]));}
  set(k,v){this.values.set(k.toLowerCase(),v);}
  get(k){return this.values.get(k.toLowerCase())||null;}
  has(k){return this.values.has(k.toLowerCase());}
  forEach(callback){for(const [key,value] of this.values)callback(value,key);}
}
class ParamsMock {
  constructor(values={}){this.values={...values};}
  set(key,value){this.values[key]=String(value);}
  toString(){return Object.entries(this.values).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');}
}
class CustomEventMock {
  constructor(type,options){this.type=type;this.detail=options?.detail;}
}
async function scenario(validFile,abortStream=false,transient404=false) {
  const user='11111111-1111-1111-1111-111111111111';
  const answer='33333333-3333-3333-3333-333333333333';
  const conversation='22222222-2222-2222-2222-222222222222';
  const listeners={},output=[],requests=[];
  let historyRequests=0;
  const document={
    addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn),
    dispatchEvent:event=>{
      if(event.type==='gpt-tweaks:handoff:result')output.push(JSON.parse(event.detail));
      for(const fn of listeners[event.type]||[])fn(event);
    }
  };
  const asJson=data=>({ok:true,json:async()=>data});
  const window={fetch:async(url,options={})=>{
    requests.push(String(url));
    if(url==='/backend-api/f/conversation')return {
      ok:true,clone:()=>({ok:true,headers:{get:()=> 'text/event-stream'},
        body:{getReader:()=>({
          read:async()=>{
            if(abortStream){
              const error=new Error('signal is aborted without reason');
              error.name='AbortError';
              throw error;
            }
            return {done:true};
          },
          releaseLock(){}
        })}})
    };
    if(url.startsWith('https://chatgpt.com/backend-api/conversations/')){
      historyRequests++;
      if(transient404&&historyRequests===1)return {ok:false,status:404};
      if(!url.includes('num_turns=2')||!url.includes('include_has_versions=true')||
         options.headers?.get('chatgpt-account-id')!=='account-id'||
         options.headers?.get('x-openai-web-frontend')!=='codex_webview')
        return {ok:false,status:404};
      return asJson({messages:[
        {id:user,author:{role:'user'}},
        {id:answer,author:{role:'assistant'},recipient:'all',end_turn:true,
          status:'finished_successfully',metadata:{is_complete:true},
          content:{parts:[validFile?
            '[Session-Handoff.md](sandbox:/mnt/data/Session-Handoff.md)':'File unavailable']}}
      ]});
    }
    if(url.includes('/interpreter/download?'))return asJson({
      status:'success',file_name:'Session-Handoff.md',mime_type:'text/markdown',
      download_url:'https://chatgpt.com/backend-api/estuary/content?sample=1'
    });
    if(url.includes('/estuary/content'))return {
      ok:true,headers:{get:()=> 'text/markdown'},
      text:async()=> '# Handoff\n'+ 'Context '.repeat(20)
    };
    throw Error('Unexpected request: '+url);
  }};
  const location={origin:'https://chatgpt.com',pathname:'/c/'+conversation};
  vm.runInNewContext(source,{
    window,document,location,URL:URLMock,URLSearchParams:ParamsMock,
    Headers:HeadersMock,Request:class{},CustomEvent:CustomEventMock,setTimeout
  });
  document.dispatchEvent(new CustomEventMock('gpt-tweaks:handoff:arm',{detail:'1234567890123456'}));
  await window.fetch('/backend-api/f/conversation',{
    method:'POST',body:JSON.stringify({conversation_id:conversation,
      messages:[{id:user,author:{role:'user'},content:{parts:['為本對話製交接文件']}}]}),
    headers:{'chatgpt-account-id':'account-id','x-openai-web-frontend':'codex_webview'}
  });
  for(let i=0;i<100&&!output.length;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(output.length,1);
  assert.equal(historyRequests,transient404?2:1,'must request HAR-style conversation history');
  assert.equal(output[0].ok,validFile);
  assert.equal(requests.length,(validFile?4:2)+(transient404?1:0));
  if(validFile){
    const lookup=requests.find(item=>item.includes('/interpreter/download?'));
    assert.ok(lookup.includes('download_intent=false'));
    assert.ok(lookup.includes('message_id='+answer));
    assert.match(output[0].text,/^# Handoff/);
  }else assert.match(output[0].error,/did not include Session-Handoff.md/);
}
(async()=>{
  await scenario(true);
  await scenario(false);
  // Regression: the browser can abort SSE after a valid final answer was
  // persisted. The authoritative conversation record must still be checked.
  await scenario(true,true);
  await scenario(false,true);
  await scenario(true,false,true);
  await scenario(true,true,true);
  console.log('PASS: stream completion, final-turn verification and file retrieval');
})().catch(error=>{console.error(error);process.exitCode=1;});
