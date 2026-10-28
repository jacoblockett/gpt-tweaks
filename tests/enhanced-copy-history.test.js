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
function setup({failPage=false,onlyFirst=false,repeatCursor=false}={}){
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
  const before=await test.request('before');
  assert.equal(before.ok,true);
  assert.equal(test.urls.length,2,
    'before must traverse older pages because the API only pages backwards');
  assert.equal(test.progress.length,1,'pagination notifies UI that more history is needed');
  assert.equal(test.progress[0],before.id,'notification is scoped to the active request');
  assert.match(before.text,/Question 1[\s\S]*js[\s\S]*42[\s\S]*Question 2/);
  assert.doesNotMatch(before.text,/Answer 2/);
  const after=await test.request('after');
  assert.equal(after.ok,true);
  assert.equal(test.urls.length,3,
    'after on a recent message must fetch only one page, not the full conversation');
  assert.equal(test.progress.length,1,
    'after within the first page must not announce unnecessary pagination');
  assert.match(after.text,/Question 2[\s\S]*\*\*Answer 2\*\*/);
  assert.doesNotMatch(after.text,/42/);
  const all=await test.request('all',[],null);
  assert.equal(test.urls.length,5,
    'entire history still requires every page');
  assert.equal(all.ok,true,'entire history cannot depend on a message ID');
  assert.equal(all.text.match(/## (User|Assistant)/g).length,4);
  assert.ok(all.text.includes('**Answer 2**'),'preserve original Markdown');
  assert.ok(!all.text.includes('Internal')&&!all.text.includes('thoughts'),
    'do not copy hidden, tool or reasoning records');
  assert.ok(test.urls.some(url=>url.searchParams.get('before')==='older'),
    'history must be paginated independently of virtualized message DOM');
  assert.equal(test.headers[0].get('chatgpt-account-id'),'account123');
  const ambiguous=await test.request('after',[ids[1],ids[3]],'assistant');
  assert.equal(ambiguous.ok,false,'multiple candidates without preferred response must not guess');
  assert.match(ambiguous.error,/Multiple message versions/);
  const multi=await test.request('after',[ids[1],ids[3]],'assistant',null,ids[3]);
  assert.equal(multi.ok,true);
  assert.match(multi.text,/\*\*Answer 2\*\*/);
  assert.doesNotMatch(multi.text,/Question 2/);
  const assistantFallback=await test.request('after',[],'assistant',ids[2]);
  assert.equal(test.urls.length,9,
    'assistant parent-turn resolution should stop once the parent user is found');
  assert.equal(assistantFallback.ok,true,'parent turn identifies a unique final assistant reply');
  assert.match(assistantFallback.text,/\*\*Answer 2\*\*/);
  assert.doesNotMatch(assistantFallback.text,/Question 2/);
  const userFallback=await test.request('before',[],'user',ids[2]);
  assert.equal(userFallback.ok,true,'parent turn also identifies user copy range');
  assert.doesNotMatch(userFallback.text,/Answer 2/);
  const olderAfter=setup();
  const olderSuffix=await olderAfter.request('after',[ids[0]],'user');
  assert.equal(olderSuffix.ok,true);
  assert.equal(olderAfter.urls.length,2,
    'older selected messages fetch only as far as their page');
  assert.match(olderSuffix.text,/Question 1[\s\S]*Answer 2/);

  const failedOlderPage=setup({failPage:true});
  const recentSuffix=await failedOlderPage.request('after',[ids[2]],'user');
  assert.equal(recentSuffix.ok,true,
    'after must not request irrelevant older pages even if they would fail');
  assert.equal(failedOlderPage.urls.length,1);
  const oldSuffix=await setup({failPage:true}).request('after',[ids[0]],'user');
  assert.equal(oldSuffix.ok,false,
    'after must fail rather than omit the selected message when older pages fail');

  const unavailable=await setup({failPage:true}).request('all',[],null);
  assert.equal(unavailable.ok,false,'failed older page must never yield partial copy');
  assert.match(unavailable.error,/HTTP 404/);
  const immediate=setup({onlyFirst:true});
  await immediate.request('all',[],null);
  assert.equal(immediate.progress.length,0,'a single-page history must not announce extra loading');
  const missing=await setup({onlyFirst:true}).request('before',[ids[0]],'user');
  assert.equal(missing.ok,false);
  assert.match(missing.error,/could not be matched/);
  const cursor=await setup({repeatCursor:true}).request('all',[],null);
  assert.equal(cursor.ok,false);
  assert.match(cursor.error,/pagination did not advance/);
  const ignoredOldCursor=setup({repeatCursor:true});
  const early=await ignoredOldCursor.request('after',[ids[2]],'user');
  assert.equal(early.ok,true);
  assert.equal(ignoredOldCursor.urls.length,1,
    'after never requests irrelevant pages or observes their broken cursors');
  console.log('PASS: suffix short-circuit, exact request counts, inclusive boundaries, full and before scans, errors');
})().catch(error=>{console.error(error);process.exitCode=1});
