const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const path=require('path'); const root=path.resolve(__dirname,'..');
const source=path=>fs.readFileSync(root+'/'+path,'utf8');
function wait(ms=40){return new Promise(r=>setTimeout(r,ms))}
const uuid='12345678-1234-1234-1234-123456789abc';
const user='11111111-2222-3333-4444-555555555555';
const assistant='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
async function main(){
  const pure={console,globalThis:null};pure.globalThis=pure;
  vm.runInNewContext(source('utilities/context-tracker/tracker-core.js'),pure);
  const core=pure.CTCore;
  assert.equal(core.summarizePage([{id:user,author:{role:'user'},content:{parts:['Hello','world']}},{id:assistant,author:{role:'assistant'},channel:'final',recipient:'all',end_turn:true,content:{parts:['Hi']}},{id:'t1',author:{role:'tool'},content:{parts:['tool reply']}}]).reduce((n,e)=>n+e[2],0),2);
  assert.equal(core.summarizeMessage({id:'x',author:{role:'user'},metadata:{is_visually_hidden_from_conversation:true},content:{parts:['abc']}})[2],0);
  assert.deepEqual(Array.from(core.uniqueEntries([['x',2,1],['x',3,1],['y',4,0]])),[['x',2,1],['y',4,0]]);
  assert.equal(core.metrics([['u',10,1],['a',20,1]]).tokens,30);
  assert(core.estimateText('한글 English 123')>0);
  assert.equal(core.contentTexts({parts:['dup'],text:'dup'}).length,1);
  let headersSeen=false;
  const events=new Map(),emitted=[];
  const doc={documentElement:{dataset:{}},addEventListener(name,fn){const a=events.get(name)||[];a.push(fn);events.set(name,a)},dispatchEvent(e){emitted.push({type:e.type,detail:e.detail});for(const fn of events.get(e.type)||[])fn(e);return true}};
  const loc={origin:'https://chatgpt.com',href:`https://chatgpt.com/c/${uuid}`,pathname:`/c/${uuid}`};
  const payload={messages:[{id:user,author:{role:'user'},content:{parts:['hello']}}],page_info:{has_previous_page:false,start_cursor:null}};
  const outgoing={conversation_id:uuid,messages:[{id:user,author:{role:'user'},content:{parts:['hello']}}]};
  const encoder=new TextEncoder();
  const sse=[`data: ${JSON.stringify({conversation_id:uuid,v:{message:{id:assistant,author:{role:'assistant'},recipient:'all',channel:'final',content:{parts:['Answer']}}}})}\n\n`,`data: ${JSON.stringify({v:[{p:'/message/content/parts/0',o:'append',v:' more'}]})}\n\n`,'data: [DONE]\n\n'].join('');
  const fetch=async (input,init)=>{
    const url=typeof input==='string'?input:input.url;
    if(String(url).includes('/conversations/')){headersSeen=true;return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}})}
    if(String(url).includes('/f/conversation'))return new Response(sse,{status:200,headers:{'content-type':'text/event-stream'}});
    throw Error('unexpected request '+url);
  };
  class E {constructor(type,opts={}){this.type=type;this.detail=opts.detail}}
  const world={console,window:null,globalThis:null,document:doc,location:loc,fetch,Response,Request,Headers,URL,AbortController,TextDecoder,CustomEvent:E,Event:E,setTimeout,clearTimeout};world.window=world;world.globalThis=world;
  vm.runInNewContext(source('utilities/context-tracker/tracker-core.js'),world);
  vm.runInNewContext(source('utilities/context-tracker/history-bridge.js'),world);
  await world.fetch(`https://chatgpt.com/backend-api/conversations/${uuid}`);
  await wait();
  assert(headersSeen);
  assert(emitted.some(e=>e.type==='ct-v1-history'&&JSON.parse(e.detail).type==='native'));
  await world.fetch('https://chatgpt.com/backend-api/f/conversation',{method:'POST',body:JSON.stringify(outgoing)});
  await wait(300);
  const sent=emitted.filter(e=>e.type==='ct-v1-outgoing').map(e=>JSON.parse(e.detail));
  assert.equal(sent[0].entries[0][0],user);
  const stream=emitted.filter(e=>e.type==='ct-v1-stream').map(e=>JSON.parse(e.detail));
  assert(stream.some(e=>e.type==='update'&&e.entries.some(x=>x[0]===assistant)));
  assert(stream.some(e=>e.type==='done'));
  assert(!JSON.stringify(emitted).includes('Answer more')); // No text across MAIN/ISOLATED boundary.
  // Isolated coordinator: mocked storage and view, one native page and optimistic send.
  const storageData=new Map(),snapshots=[],visibility=[],mounted=[];
  let navChanges=()=>{}, targetCallback=()=>{};
  const isolated={console,document:{...doc,hidden:false,getElementById(){return null}},location:loc,globalThis:null,window:{addEventListener(){},navigation:{addEventListener(){} }},Event:E,CustomEvent:E,setTimeout,clearTimeout,AbortController,DOMException,MutationObserver:class {observe(){}disconnect(){}},chrome:{runtime:{onMessage:{addListener:fn=>navChanges=fn}}},
    GPTTweaksContextStorage:{preferences:async()=>({enabled:true,defaultVisible:true,target:512000,percent:true,tokens:true,limit:true,messages:true}),load:async id=>storageData.get(id)||null,save:async(id,cache)=>{storageData.set(id,cache)},setTarget:async v=>storageData.set("target",v)},
    GPTTweaksContextIndicator:(core,updateTarget)=>{targetCallback=updateTarget;return ({setVisible:v=>visibility.push(v),setConversation:id=>mounted.push(id),render:s=>snapshots.push({messages:core.metrics([...s.activeEntries,...s.streamEntries.values()]).messages,target:s.target}),isMounted:()=>true,mount(){},updateTheme(){},align(){}})}};
  isolated.globalThis=isolated;isolated.CTCore=core;
  vm.runInNewContext(source('utilities/context-tracker/index.js'),isolated);
  await wait(80);
  assert(visibility.includes(true));assert(mounted.includes(uuid));
  doc.dispatchEvent(new E('ct-v1-outgoing',{detail:JSON.stringify({id:uuid,entries:[[user,4,1]]})}));
  await wait(25);
  assert(snapshots.some(s=>s.messages===1));
  doc.dispatchEvent(new E('ct-v1-history',{detail:JSON.stringify({type:'native',id:uuid,response:{entries:[[user,4,1],[assistant,9,1]],page_info:{has_previous_page:false,start_cursor:null}}})}));
  await wait(50);
  assert(snapshots.some(s=>s.messages===2));
  assert.equal(storageData.get(uuid).entries.length,2);
  navChanges({type:'gpt-tweaks:context:settings-changed'});
  await wait(25);
  assert(snapshots.every(s=>s.target===512000));
  assert.equal(await targetCallback(512001),true);
  assert.equal(storageData.get('target'),512001);
  assert.equal(snapshots.at(-1).target,512001);
  // Background bridge explicitly restricts privileged reads and writes.
  const priv=new Map([['gpt-tweaks.github.oauth-token','private-test-token'],
    ['gpt-tweaks.context.target-tokens','750000']]);
  let bgListener,changeListener,tabBroadcasts=0;
  const chromeMock={runtime:{id:'test-extension',onMessage:{addListener:f=>bgListener=f},
      openOptionsPage:async()=>true},tabs:{query:async()=>[{id:7}],
      sendMessage:async()=>{tabBroadcasts++}},
    storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>priv.has(k)).map(k=>[k,priv.get(k)])),
      set:async record=>{for(const [k,v] of Object.entries(record))priv.set(k,v)}},
      onChanged:{addListener:f=>changeListener=f}}};
  vm.runInNewContext(source('chrome/context-bridge.js'),{chrome:chromeMock,console});
  function rpc(msg,sender){return new Promise((resolve,reject)=>{
    const asynchronous=bgListener(msg,sender,resolve);
    if(asynchronous===undefined)reject(Error('message not handled'));
  })}
  const validSender={id:'test-extension',url:`https://chatgpt.com/c/${uuid}`,tab:{id:7}};
  assert.equal((await rpc({type:'gpt-tweaks:context:preferences'},validSender)).data.target,750000);
  assert.equal((await rpc({type:'gpt-tweaks:context:preferences'},{...validSender,url:'https://github.com/'})).ok,false);
  assert.equal((await rpc({type:'gpt-tweaks:context:set-target',target:0},validSender)).ok,false);
  assert.equal((await rpc({type:'gpt-tweaks:context:set-target',target:1.5},validSender)).ok,false);
  assert.equal((await rpc({type:'gpt-tweaks:context:set-target',target:512001},validSender)).ok,true);
  assert.equal(priv.get('gpt-tweaks.context.target-tokens'),'512001');
  assert.equal((await rpc({type:'gpt-tweaks:context:set-target',target:512001},{...validSender,url:'https://github.com/'})).ok,false);
  const record={version:1,algorithm:'network-text-deduplicated-fullscan-contextfix-finalcount',
    entries:[[user,8,1]],observedEntries:[],complete:true,updated:Date.now()};
  assert.equal((await rpc({type:'gpt-tweaks:context:save',id:uuid,cache:record},validSender)).ok,true);
  assert.equal((await rpc({type:'gpt-tweaks:context:load',id:uuid},validSender)).data.entries[0][1],8);
  assert.equal((await rpc({type:'gpt-tweaks:context:save',id:uuid,cache:{...record,entries:[[user,'conversation text',1]]}},validSender)).ok,false);
  assert.equal(priv.get('gpt-tweaks.github.oauth-token'),'private-test-token');
  await changeListener({'gpt-tweaks.context.target-tokens':{newValue:'600000'}},'local');
  await wait(20);
  assert.equal(tabBroadcasts,1);
  console.log('PASS: storage authorization, numeric cache validation, scoped settings, GitHub credentials unchanged');
  console.log('PASS: core classification/dedupe, MAIN passive history/stream/outgoing, isolated reconciliation/storage/settings');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});