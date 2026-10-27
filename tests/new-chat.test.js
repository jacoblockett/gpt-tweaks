'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const messages=[],tabs=[],windows=[];
let saved={},senderUrl='https://chatgpt.com/c/123';
const listeners=[];
const runtime={
  id:'test-extension',
  onMessage:{addListener:fn=>listeners.push(fn)},
  async sendMessage(message) {
    messages.push(message);
    let result;
    const async= listeners[0](message,{
      id:'test-extension',tab:{id:7},url:senderUrl
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
  constructor(isSidebar=true,projectId=null){this.isSidebar=isSidebar;this.projectId=projectId;}
  closest(selector) {
    if(selector.startsWith('button['))return this;
    if(selector==='[data-app-action-sidebar-project-id]')
      return this.projectId?{getAttribute:()=>this.projectId}:null;
    return this.isSidebar?this:null;
  }
  getAttribute(name){
    return name==='aria-label'?(this.projectId?'New chat in Project':'New chat'):null;
  }
}
const doc={
  hidden:false,
  addEventListener:(type,fn)=>(events.document[type]??=[]).push(fn),
  createElementNS:()=>({setAttribute(){},append(){}})
};
const win={addEventListener:(type,fn)=>(events.window[type]??=[]).push(fn)};
const location={pathname:'/c/123'};
const world={__gptTweaksMenus:{register:registration=>world.menu=registration}};
const clientContext={globalThis:world,chrome,document:doc,window:win,location,Element,console};
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
  // Verify SPA project transitions from both shortcuts.
  const project='g-p-6ade99a4de10819199a379c4360120df';
  const other='g-p-6ad4601062008191a6a3fd8642fff51b';
  location.pathname='/g/'+project+'/c/123';
  senderUrl='https://chatgpt.com/c/123';
  dispatch('auxclick');
  await settle();
  assert.equal(tabs[2].url,'https://chatgpt.com/g/'+project+'/project');
  world.menu.activate('slash');
  await settle();
  assert.equal(tabs[3].url,'https://chatgpt.com/g/'+project+'/project');
  // Clicking a different project's row explicitly opens that project.
  dispatch('auxclick',new Element(true,other));
  await settle();
  assert.equal(tabs[4].url,'https://chatgpt.com/g/'+other+'/project');
  location.pathname='/';
  dispatch('auxclick',new Element(true,other));
  await settle();
  assert.equal(tabs[5].url,'https://chatgpt.com/g/'+other+'/project');
  location.pathname='/g/'+project+'/project';
  world.menu.activate('slash');
  await settle();
  assert.equal(tabs[6].url,'https://chatgpt.com/g/'+project+'/project');
  location.pathname='/c/999';
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
  assert.equal((await runtime.sendMessage({
    type:'gpt-tweaks:new-chat:open',method:'middle',projectId:'bad/id'
  })).ok,false);
  let rejected;
  listeners[0]({type:'gpt-tweaks:new-chat:open',method:'middle'},
    {id:'test-extension',tab:{id:7},url:'https://example.com/'},value=>{rejected=value;});
  assert.equal(rejected.ok,false);
  console.log('PASS: general/project routes, explicit project buttons, SPA navigation, preferences, and authorization');
})().catch(error=>{console.error(error);process.exitCode=1;});
