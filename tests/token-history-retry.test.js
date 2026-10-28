'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../utilities/token-estimator/history-bridge.js'),'utf8');
const id='11111111-2222-3333-4444-555555555555';
const user='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const page={messages:[{id:user,author:{role:'user'},content:{parts:['hello']}}],
  page_info:{has_previous_page:false,start_cursor:null}};

async function scenario({failures=0,alwaysFail=false,abort=false}={}) {
  const callbacks=new Map(),published=[];
  const document={
    documentElement:{dataset:{}},
    addEventListener(type,fn){callbacks.set(type,[...(callbacks.get(type)||[]),fn]);},
    dispatchEvent(event){
      if(event.type==='ct-v1-history')published.push(JSON.parse(event.detail));
      for(const fn of callbacks.get(event.type)||[])fn(event);
    }
  };
  class EventMock {constructor(type,opts={}){this.type=type;this.detail=opts.detail;}}
  let attempts=0;
  const window={fetch:async()=>{
    attempts++;
    if(alwaysFail||attempts<=failures) {
      if(abort&&attempts===1)
        document.dispatchEvent(new EventMock('ct-v1-history-cancel',{detail:'7'}));
      throw new TypeError('Failed to fetch');
    }
    return {ok:true,json:async()=>page};
  }};
  vm.runInNewContext(source,{
    window,document,location:{origin:'https://chatgpt.com',
      pathname:'/c/'+id,href:'https://chatgpt.com/c/'+id},
    URL,Headers,Request,AbortController,TextDecoder,CustomEvent:EventMock,Event:EventMock,
    setTimeout:(fn)=>setTimeout(fn,1),clearTimeout
  });
  document.dispatchEvent(new EventMock('ct-v1-history-request',{
    detail:JSON.stringify({id,seq:7,pageSize:2})
  }));
  for(let i=0;i<50&&!published.length&&!abort;i++)await new Promise(resolve=>setTimeout(resolve,5));
  if(abort)await new Promise(resolve=>setTimeout(resolve,20));
  if(abort){
    assert.equal(attempts,1,'canceled request must not retry');
    assert.equal(published.length,0,'canceled request must not publish an error');
  }else if(alwaysFail){
    assert.equal(attempts,3,'network failures receive at most two retries');
    assert.equal(published.length,1);
    assert.equal(published[0].type,'error');
    assert.match(published[0].error,/Failed to fetch/);
  }else{
    assert.equal(attempts,failures+1);
    assert.equal(published.length,1);
    assert.equal(published[0].type,'result');
    assert.equal(published[0].response.entries[0][0],user);
  }
}
(async()=>{
  await scenario({failures:1});
  await scenario({failures:2});
  await scenario({alwaysFail:true});
  await scenario({abort:true,alwaysFail:true});
  console.log('PASS: retry transient history fetch failure, preserve errors, cancel promptly');
})().catch(error=>{console.error(error);process.exitCode=1});
