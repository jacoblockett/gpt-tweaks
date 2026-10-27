'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const messages=[],tabs=[],windows=[];
let saved={};
const listeners=[];
const runtime={
  id:'test-extension',
  onMessage:{addListener:fn=>listeners.push(fn)},
  async sendMessage(message) {
    messages.push(message);
    let result;
    const async= listeners[0](message,{
      id:'test-extension',tab:{id:7},url:'https://chatgpt.com/c/123'
    },value=>{result=value;});
    assert.equal(async,true);
    for(let i=0;i<8&&result===undefined;i++)await Promise.resolve();
    assert.notEqual(result,undefined);
    return result;
  }
};
const chrome={
  runtime,
  storage:{local:{get:async()=>({...saved})}},
  tabs:{create:async args=>{tabs.push(args);}},
  windows:{create:async args=>{windows.push(args);}}
};
vm.runInNewContext(read('chrome/new-chat-bridge.js'),{chrome,URL,Number,String});
const events={document:{},window:{}};
class Element {
  constructor(isSidebar=true){this.isSidebar=isSidebar;}
  closest(selector) {
    if(selector.startsWith('button['))return this;
    return this.isSidebar?this:null;
  }
}
const doc={
  hidden:false,
  addEventListener:(type,fn)=>(events.document[type]??=[]).push(fn),
  createElementNS:()=>({setAttribute(){},append(){}})
};
const win={addEventListener:(type,fn)=>(events.window[type]??=[]).push(fn)};
const world={__gptTweaksMenus:{register:registration=>world.menu=registration}};
const clientContext={globalThis:world,chrome,document:doc,window:win,Element,console};
vm.runInNewContext(read('utilities/new-chat/index.js'),clientContext);
vm.runInNewContext(read('utilities/new-chat/ui/menu.js'),clientContext);
async function settle() {for(let i=0;i<15;i++)await Promise.resolve();}
function dispatch(type,target=new Element()) {
  const event={
    type,button:1,target,prevented:false,stopped:false,
    preventDefault(){this.prevented=true;},
    stopImmediatePropagation(){this.stopped=true;}
  };
  for(const fn of events.document[type]||[])fn(event);
  return event;
}
(async()=>{
  await settle();
  assert.equal(await world.menu.isEnabled('menu'),false,'no + menu action');
  assert.equal(await world.menu.isEnabled('slash'),true);
  assert.equal(dispatch('mousedown').prevented,true);
  assert.equal(dispatch('auxclick').prevented,true);
  await settle();
  assert.equal(tabs.length,1);
  assert.equal(tabs[0].active,false,'middle-click leaves current chat active');
  assert.equal(dispatch('auxclick',new Element(false)).prevented,false);
  world.menu.activate('slash');
  await settle();
  assert.equal(tabs.length,2);
  assert.equal(tabs[1].active,true,'slash command focuses new tab');
  saved['gpt-tweaks.new-chat.destination']='window';
  for(const fn of events.window.focus)fn();
  await settle();
  dispatch('auxclick');
  await settle();
  assert.equal(windows.length,1);
  assert.equal(windows[0].focused,false);
  saved['gpt-tweaks.new-chat.middle-click']='false';
  for(const fn of events.window.focus)fn();
  await settle();
  assert.equal(dispatch('auxclick').prevented,false);
  assert.equal(await world.menu.isEnabled('slash'),true);
  saved['gpt-tweaks.new-chat.slash']='false';
  for(const fn of events.window.focus)fn();
  await settle();
  assert.equal(await world.menu.isEnabled('slash'),false);
  assert.equal((await runtime.sendMessage({type:'gpt-tweaks:new-chat:open',method:'slash'})).ok,false);
  let rejected;
  listeners[0]({type:'gpt-tweaks:new-chat:open',method:'middle'},
    {id:'test-extension',tab:{id:7},url:'https://example.com/'},value=>{rejected=value;});
  assert.equal(rejected.ok,false);
  console.log('PASS: settings, middle-click, slash command, destination, and sender authorization');
})().catch(error=>{console.error(error);process.exitCode=1;});
