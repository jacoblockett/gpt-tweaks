'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../utilities/enhanced-copy/history-bridge.js'),'utf8');
const conversation='11111111-2222-3333-4444-555555555555';
const ids=['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd'];
const user=(id,text)=>({id,author:{role:'user'},content:{parts:[text]}});
const assistant=(id,text)=>({id,author:{role:'assistant'},recipient:'all',
  end_turn:true,channel:'final',content:{parts:[text]}});
function setup({failPage=false,onlyFirst=false}={}){
  const listeners=new Map(),results=[],urls=[],headers=[];
  class Event {constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  const document={
    documentElement:{dataset:{themeAccountId:'account123',codexWindowType:'browser'}},
    addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);},
    dispatchEvent(event){
      if(event.type==='gpt-tweaks:copy:result')results.push(JSON.parse(event.detail));
      for(const fn of listeners.get(event.type)||[])fn(event);
    }
  };
  const window={fetch:async(url,options={})=>{
    const target=new URL(url,'https://chatgpt.com');
    urls.push(target);headers.push(options.headers);
    const before=target.searchParams.get('before');
    if(failPage&&before)return {ok:false,status:404};
    return {ok:true,json:async()=>!before?{
      messages:[user(ids[2],'Question 2'),assistant(ids[3],'Answer 2'),
        {...assistant('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','Internal'),metadata:{is_visually_hidden_from_conversation:true}}],
      page_info:{has_previous_page:!onlyFirst,start_cursor:'older'}
    }:{
      messages:[user(ids[0],'Question 1'),assistant(ids[1],'Answer 1'),user(ids[2],'Question 2')],
      page_info:{has_previous_page:false,start_cursor:null}
    }};
  }};
  vm.runInNewContext(source,{window,document,Event,CustomEvent:Event,
    location:{origin:'https://chatgpt.com',href:'https://chatgpt.com/c/'+conversation},
    URL,Headers,Request,AbortController,setTimeout,clearTimeout});
  async function request(scope,messageId=ids[2]){
    const id='req'+String(results.length+1).padStart(15,'0');
    document.dispatchEvent(new Event('gpt-tweaks:copy:request',{detail:JSON.stringify({
      id,conversationId:conversation,messageId,scope
    })}));
    for(let tries=0;tries<100&&!results.some(result=>result.id===id);tries++)
      await new Promise(resolve=>setTimeout(resolve,1));
    return results.find(result=>result.id===id);
  }
  return {request,urls,headers};
}
(async()=>{
  const test=setup();
  const before=await test.request('before');
  assert.equal(before.ok,true);
  assert.match(before.text,/Question 1[\s\S]*Answer 1[\s\S]*Question 2/);
  assert.doesNotMatch(before.text,/Answer 2/);
  const after=await test.request('after');
  assert.equal(after.ok,true);
  assert.match(after.text,/Question 2[\s\S]*Answer 2/);
  assert.doesNotMatch(after.text,/Answer 1/);
  const all=await test.request('all');
  assert.equal(all.ok,true);
  assert.equal(all.text.match(/## (User|Assistant)/g).length,4);
  assert.equal(all.text.includes('Internal'),false);
  assert.ok(test.urls.some(url=>url.searchParams.get('before')==='older'));
  assert.equal(test.headers[0].get('chatgpt-account-id'),'account123');
  const unavailable=await setup({failPage:true}).request('all');
  assert.equal(unavailable.ok,false,'never copy partial results when older pages fail');
  assert.match(unavailable.error,/HTTP 404/);
  const missing=await setup({onlyFirst:true}).request('before',ids[0]);
  assert.equal(missing.ok,false,'missing anchor must not select the wrong message');
  console.log('PASS: complete paginated conversation, inclusive ranges, roles, duplicates and 404 safety');
})().catch(error=>{console.error(error);process.exitCode=1});
