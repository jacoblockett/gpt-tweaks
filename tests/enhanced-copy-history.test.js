'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const content=fs.readFileSync(path.join(__dirname,'../shared/conversation/content.js'),'utf8');
const history=fs.readFileSync(path.join(__dirname,'../shared/conversation/history.js'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../utilities/enhanced-copy/history-bridge.js'),'utf8');
const conversation='11111111-2222-3333-4444-555555555555';
const ids=['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd'];
const user=(id,text)=>({id,author:{role:'user'},content:{content_type:'text',parts:[text]}});
const assistant=(id,text)=>({id,author:{role:'assistant'},recipient:'all',
  end_turn:true,channel:'final',content:{content_type:'text',parts:[text]}});
function setup({failPage=false,onlyFirst=false,repeatCursor=false,pages=null}={}){
  const listeners=new Map(),results=[],urls=[],headers=[],progress=[];
  class Event {constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  const document={
    documentElement:{dataset:{themeAccountId:'account123',codexWindowType:'browser'}},
    addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);},
    dispatchEvent(event){
      if(event.type==='gpt-tweaks:copy:result')results.push(JSON.parse(event.detail));
      if(event.type==='gpt-tweaks:copy:progress')progress.push(event.detail);
      for(const fn of listeners.get(event.type)||[])fn(event);
    }
  };
  const window={fetch:async(url,options={})=>{
    const target=new URL(url,'https://chatgpt.com');
    urls.push(target);headers.push(options.headers);
    const before=target.searchParams.get('before');
    if(pages){
      const index=before?Number(before.slice(1)):0;
      if(!Number.isSafeInteger(index)||index>=pages.length)
        return {ok:false,status:404};
      return {ok:true,json:async()=>({
        messages:pages[index],
        page_info:{has_previous_page:index+1<pages.length,
          start_cursor:index+1<pages.length?'p'+(index+1):null}
      })};
    }
    if(failPage&&before)return {ok:false,status:404};
    return {ok:true,json:async()=>!before?{
      messages:[user(ids[2],'Question 2'),assistant(ids[3],'**Answer 2**'),
        {...assistant('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','Internal'),
          metadata:{is_visually_hidden_from_conversation:true}},
        {id:'ffffffff-ffff-ffff-ffff-ffffffffffff',author:{role:'assistant'},
          channel:'analysis',recipient:'all',end_turn:false,content:{parts:['thoughts']}}],
      page_info:{has_previous_page:!onlyFirst,start_cursor:'older'}
    }:{
      messages:[user(ids[0],'Question 1'),assistant(ids[1],'\`\`\`js\\n42\\n\`\`\`'),
        user(ids[2],'Question 2')],
      page_info:{has_previous_page:repeatCursor,start_cursor:repeatCursor?'older':null}
    }};
  }};
  const environment={window,globalThis:window,document,Event,CustomEvent:Event,
    location:{origin:'https://chatgpt.com',href:'https://chatgpt.com/c/'+conversation},
    URL,Headers,Request,AbortController,setTimeout:fn=>setTimeout(fn,1),clearTimeout};
  vm.runInNewContext(content,environment);
  vm.runInNewContext(history,environment);
  vm.runInNewContext(source,environment);
  async function request(scope,messageIds=[ids[2]],role='user',turnKey=null,preferredMessageId=null){
    const id='req'+String(results.length+1).padStart(15,'0');
    document.dispatchEvent(new Event('gpt-tweaks:copy:request',{detail:JSON.stringify({
      id,conversationId:conversation,messageIds,turnKey,preferredMessageId,role,scope
    })}));
    for(let tries=0;tries<150&&!results.some(result=>result.id===id);tries++)
      await new Promise(resolve=>setTimeout(resolve,2));
    return results.find(result=>result.id===id);
  }
  return {request,urls,headers,window,progress};
}
(async()=>{
  const test=setup();
  const all=await test.request('all',[],null);
  assert.equal(all.ok,true,'full history must not depend on a selected message ID');
  assert.equal(test.urls.length,2,'read both pages, no more and no fewer');
  assert.equal(all.text.match(/## (User|Assistant)/g).length,4);
  assert.match(all.text,/Question 1[\s\S]*42[\s\S]*Question 2[\s\S]*Answer 2/);
  assert.ok(all.text.includes('**Answer 2**'),'original Markdown is preserved');
  assert.ok(!all.text.includes('Internal')&&!all.text.includes('thoughts'),
    'hidden, tool and reasoning records are excluded');
  assert.equal(test.progress.length,0,'persistent loading toast needs no pagination notifications');
  assert.ok(test.urls.some(url=>url.searchParams.get('before')==='older'));
  assert.equal(test.headers[0].get('chatgpt-account-id'),'account123');

  const invalid=setup();
  const unsupported=await invalid.request('after',[ids[2]],'user');
  assert.equal(unsupported,undefined,'before/after scopes are no longer supported');
  assert.equal(invalid.urls.length,0,'unsupported scopes must never request history');

  const unavailable=await setup({failPage:true}).request('all',[],null);
  assert.equal(unavailable.ok,false,'failed older page must not return an incomplete copy');
  assert.match(unavailable.error,/HTTP 404/);
  const immediate=setup({onlyFirst:true});
  const short=await immediate.request('all',[],null);
  assert.equal(short.ok,true);
  assert.equal(immediate.urls.length,1,'short conversations take one history request');
  const cursor=await setup({repeatCursor:true}).request('all',[],null);
  assert.equal(cursor.ok,false);
  assert.match(cursor.error,/pagination did not advance/);

  const longId=i=>i.toString(16).padStart(8,'0')+'-2222-3333-4444-555555555555';
  const pages=Array.from({length:6},(_,page)=>{
    const n=10-page*2;
    return [user(longId(n),'Question '+n),assistant(longId(n+1),'Answer '+(n+1))];
  });
  const lengthy=setup({pages});
  const complete=await lengthy.request('all',[],null);
  assert.equal(complete.ok,true);
  assert.equal(lengthy.urls.length,6,'all history pages are requested');
  assert.equal((complete.text.match(/## (User|Assistant)/g)||[]).length,12);
  assert.match(complete.text,/Question 0[\s\S]*Answer 11/);
  console.log('PASS: full-only on-demand history, pagination, Markdown, filtered dialogue and errors');
})().catch(error=>{console.error(error);process.exitCode=1});
