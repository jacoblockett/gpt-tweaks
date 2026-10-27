(() => {
  "use strict";
  if(globalThis.__gptTweaksMenus)return;
  const adapters=new Map();
  let observer=null,scanQueued=false,scanTimer=null;
  let plusRoot=null,plusSelected=null,plusIndex=0,plusTouched=false;
  let slashRoot=null,slashSelected=null,slashIndex=0,slashTouched=false,slashQuery=null;
  function localComposer() {
    return document.querySelector('[data-composer-input] [contenteditable="true"][role="textbox"]') ||
      document.querySelector('[data-testid="composer-text-input"]') ||
      document.querySelector('#prompt-textarea') ||
      document.querySelector('[contenteditable="true"][role="textbox"]');
  }

  // Register a utility providing:
  // id, command, title, description, icon(size), isEnabled(method),
  // activate(method), and optional isOpen() for dialog keyboard isolation.
  // The adapter handles native ChatGPT menu insertion, slash search,
  // highlighting, keyboard navigation, and DOM change observation.
  function register(config){
    if(!config||!/^[a-z0-9-]+$/.test(config.id||"")||
       !config.title||!config.description||!/^\/[a-z-]+$/.test(config.command||"")||
       typeof config.icon!=="function"||typeof config.isEnabled!=="function"||
       typeof config.activate!=="function")
      throw Error("Invalid ChatGPT menu utility registration.");
    if(adapters.has(config.id))throw Error("Duplicate menu utility: "+config.id);
    adapters.set(config.id,createAdapter({...config,order:adapters.size}));
    scheduleScan();
  }
  function resetSlash(){for(const adapter of adapters.values())adapter.resetSlash();}
  globalThis.__gptTweaksMenus=Object.freeze({register,resetSlash,composer:localComposer});
  function createAdapter(config){
    const visible=el=>!!(el?.isConnected&&el.getClientRects().length);
    function setMenuIcon(iconSlot){
      iconSlot.replaceChildren();
      for(const [size,klass] of [[16,"CompactSource-d7ZD01"],[20,"LeadingSource-d79mNZ"]]){
        const span=document.createElement("span");
        span.className=klass;span.setAttribute("aria-hidden","true");
        span.append(config.icon(size));iconSlot.append(span);
      }
    }
    const plus=globalThis.__gptTweaksPlusMenu(config,{visible,setMenuIcon,onPlusRowMounted});
    const slash=globalThis.__gptTweaksSlashMenu(config,{
      visible,localComposer,setMenuIcon,styleInjectedMenuRow:plus.styleInjectedMenuRow,
      mountMenuGroup:plus.mountMenuGroup,removeMenuGroup:plus.removeMenuGroup,
      onSlashRowMounted,onSlashQueryChanged,
      countUtilities:()=>adapters.size
    });
    function scan(){void plus.scanMenu();slash.ensureConnected();}
    return {scan,resetSlash:slash.resetSlash,updateSlash:slash.updateSlash,
      hasSlashMatch:slash.hasSlashMatch,handleDirectEnter:slash.handleDirectEnter,
      isOpen:()=>!!config.isOpen?.()};
  }
  const visibleRow=row=>!!(row?.isConnected&&row.getClientRects().length);
  const plusSelector='button[data-gtg-menu-option="true"]';

  // The plus menu spans several native sections. Own visual, pointer and
  // keyboard selection across the complete menu; React still owns actions.
  function plusRows(root){
    return [...root.querySelectorAll('button[data-gtg-menu-option="true"],button[data-list-navigation-item="true"]')]
      .filter(visibleRow);
  }
  function plusMenu(){
    const row=[...document.querySelectorAll(plusSelector)].find(visibleRow);
    const root=row?.closest('[data-mention-list-scroll-area]');
    return root&&visibleRow(root)?root:null;
  }
  function selectPlus(row,fromUser=false,scroll=false){
    const root=plusMenu();
    if(!root)return;
    const rows=plusRows(root);
    const index=rows.indexOf(row);
    if(index<0)return;
    if(plusRoot!==root){
      if(plusRoot?.isConnected)plusRoot.removeAttribute('data-gtg-plus-controlled');
      plusRoot=root;plusSelected=null;plusIndex=0;plusTouched=false;
    }
    if(fromUser)plusTouched=true;
    if(plusSelected===row&&row.dataset.gtgPlusSelected==='true'){
      if(scroll)row.scrollIntoView?.({block:'nearest'});
      return;
    }
    if(plusSelected)delete plusSelected.dataset.gtgPlusSelected;
    plusSelected=row;plusIndex=index;
    root.dataset.gtgPlusControlled='true';
    row.dataset.gtgPlusSelected='true';
    if(scroll)row.scrollIntoView?.({block:'nearest'});
  }
  function syncPlus(){
    const root=plusMenu();
    if(!root){
      if(plusRoot?.isConnected)plusRoot.removeAttribute('data-gtg-plus-controlled');
      plusRoot=null;plusSelected=null;plusIndex=0;plusTouched=false;
      return;
    }
    const rows=plusRows(root);
    if(!rows.length)return;
    if(root!==plusRoot){plusRoot=null;plusSelected=null;plusIndex=0;plusTouched=false;}
    // Async insertions cannot steal initial selection. After input, retain
    // the selected row across other utility insertions and React remounts.
    const target=!plusTouched?rows[0]:
      rows.includes(plusSelected)?plusSelected:rows[Math.min(plusIndex,rows.length-1)];
    selectPlus(target);
  }
  function onPlusRowMounted(){syncPlus();}

  function interceptPlusKey(event){
    const root=plusMenu();
    if(!root)return false;
    if(event.isComposing||event.altKey||event.metaKey||event.ctrlKey||
       [...adapters.values()].some(adapter=>adapter.isOpen()))return false;
    const key=event.key;
    if(!['ArrowUp','ArrowDown','Enter',' ','Tab'].includes(key))return false;
    const rows=plusRows(root);
    if(!rows.length)return false;
    if(plusRoot!==root||!rows.includes(plusSelected))syncPlus();
    const selected=rows.includes(plusSelected)?plusSelected:rows[0];
    if(key==='ArrowUp'||key==='ArrowDown'){
      event.preventDefault();event.stopImmediatePropagation();
      const step=key==='ArrowDown'?1:-1;
      selectPlus(rows[(rows.indexOf(selected)+step+rows.length)%rows.length],true,true);
      return true;
    }
    if(key==='Enter'||key===' '||(key==='Tab'&&selected.matches(plusSelector))){
      event.preventDefault();event.stopImmediatePropagation();
      selected.click();
      return true;
    }
    return false;
  }

  // Slash commands share the plus menu's single-selection model. Use the
  // complete visible command list (including fallback rows), not React's
  // partial index or the removed per-row virtual highlights.
  function slashMenu(){
    const rows=[...document.querySelectorAll('button[data-gtg-slash="true"]')].filter(visibleRow);
    const nativeRow=rows.find(row=>row.closest('[data-mention-list-scroll-area]'));
    const row=nativeRow||rows[0];
    const root=row?.closest('[data-mention-list-scroll-area]')||
      row?.closest('#gtg-command-fallback');
    return root&&visibleRow(root)?root:null;
  }
  function slashRows(root){
    return [...root.querySelectorAll('button[data-gtg-slash="true"],button[data-list-navigation-item="true"]')]
      .filter(visibleRow);
  }
  function selectSlash(row,fromUser=false,scroll=false){
    const root=slashMenu();
    if(!root)return;
    const rows=slashRows(root),index=rows.indexOf(row);
    if(index<0)return;
    if(root!==slashRoot){
      if(slashRoot?.isConnected)slashRoot.removeAttribute('data-gtg-slash-controlled');
      slashRoot=root;slashSelected=null;slashIndex=0;slashTouched=false;
    }
    if(fromUser)slashTouched=true;
    if(slashSelected===row&&row.dataset.gtgSlashSelected==='true'){
      if(scroll)row.scrollIntoView?.({block:'nearest'});
      return;
    }
    if(slashSelected)delete slashSelected.dataset.gtgSlashSelected;
    slashSelected=row;slashIndex=index;
    root.dataset.gtgSlashControlled='true';
    row.dataset.gtgSlashSelected='true';
    if(scroll)row.scrollIntoView?.({block:'nearest'});
  }
  function syncSlashSelection(){
    const root=slashMenu();
    if(!root){
      if(slashRoot?.isConnected)slashRoot.removeAttribute('data-gtg-slash-controlled');
      slashRoot=null;slashSelected=null;slashIndex=0;slashTouched=false;slashQuery=null;
      return;
    }
    const rows=slashRows(root);
    if(!rows.length)return;
    if(root!==slashRoot){
      slashRoot=null;slashSelected=null;slashIndex=0;slashTouched=false;
    }
    selectSlash(!slashTouched?rows[0]:
      rows.includes(slashSelected)?slashSelected:rows[Math.min(slashIndex,rows.length-1)]);
  }
  function onSlashRowMounted(){syncSlashSelection();}
  function onSlashQueryChanged(query){
    if(slashQuery!==query){
      slashQuery=query;slashTouched=false;
    }
    syncSlashSelection();
  }
  function interceptSlashKey(event){
    const root=slashMenu();
    if(!root||event.isComposing||event.altKey||event.metaKey||event.ctrlKey||
       [...adapters.values()].some(adapter=>adapter.isOpen()))return false;
    const key=event.key;
    if(!['ArrowUp','ArrowDown','Enter',' ','Tab'].includes(key))return false;
    const rows=slashRows(root);
    if(!rows.length)return false;
    if(root!==slashRoot||!rows.includes(slashSelected))syncSlashSelection();
    const selected=rows.includes(slashSelected)?slashSelected:rows[0];
    if(key==='ArrowUp'||key==='ArrowDown'){
      event.preventDefault();event.stopImmediatePropagation();
      const step=key==='ArrowDown'?1:-1;
      selectSlash(rows[(rows.indexOf(selected)+step+rows.length)%rows.length],true,true);
      return true;
    }
    if(key==='Enter'||key===' '||(key==='Tab'&&selected.dataset.gtgSlash==='true')){
      event.preventDefault();event.stopImmediatePropagation();
      selected.click();
      return true;
    }
    return false;
  }
  function interceptMenuKey(event){
    if(event.defaultPrevented)return;
    if(interceptPlusKey(event))return;
    interceptSlashKey(event);
  }
  function selectedSlashAdapter(){
    for(const adapter of adapters.values())
      if(adapter.hasSlashMatch())return adapter;
    return null;
  }
  // A lone slash matches multiple utilities. Update each registered adapter
  // in order, rather than selecting only the first match, and drop stale
  // queued scans when the composer text changes.
  let slashSync=Promise.resolve(),slashGeneration=0;
  function syncSlash(){
    const generation=++slashGeneration;
    slashSync=slashSync.then(async()=>{
      if(generation!==slashGeneration)return;
      const matching=[...adapters.values()].filter(adapter=>adapter.hasSlashMatch());
      for(const adapter of adapters.values())
        if(!matching.includes(adapter))adapter.resetSlash();
      for(const adapter of matching){
        if(generation!==slashGeneration)return;
        await adapter.updateSlash();
      }
      if(generation===slashGeneration)syncSlashSelection();
    }).catch(error=>console.warn("[GPT Tweaks] Slash menu sync failed:",error));
  }
  function scanAll(){
    scanQueued=false;
    for(const adapter of adapters.values())adapter.scan();
    syncPlus();
    syncSlashSelection();
    syncSlash();
  }
  function scheduleScan(){
    if(!scanQueued){scanQueued=true;scanTimer=setTimeout(scanAll,100);}
  }
  // All registered utilities share one ChatGPT mutation observer and
  // one copy of the keyboard/focus listeners.
  window.addEventListener("keydown",interceptMenuKey,true);
  function onPlusHover(event){
    const root=plusMenu();
    if(!root||!(event.target instanceof Element))return;
    const row=event.target.closest(
      'button[data-gtg-menu-option="true"],button[data-list-navigation-item="true"]');
    if(row&&root.contains(row)&&row!==plusSelected)selectPlus(row,true);
  }
  // Delegation catches movement between cloned/React-replaced rows even
  // when their individual pointerenter handlers are skipped.
  document.addEventListener('pointerover',onPlusHover,true);
  document.addEventListener('pointermove',onPlusHover,true);
  function onSlashHover(event){
    const root=slashMenu();
    if(!root||!(event.target instanceof Element))return;
    const row=event.target.closest(
      'button[data-gtg-slash="true"],button[data-list-navigation-item="true"]');
    if(row&&root.contains(row)&&row!==slashSelected)selectSlash(row,true);
  }
  document.addEventListener('pointerover',onSlashHover,true);
  document.addEventListener('pointermove',onSlashHover,true);
  document.addEventListener('mousemove',event=>{
    onPlusHover(event);
    onSlashHover(event);
  },true);
  window.addEventListener("keydown",event=>{
    selectedSlashAdapter()?.handleDirectEnter(event);
  },true);
  document.addEventListener("input",event=>{
    const composer=localComposer();
    if(composer&&(composer===event.target||composer.contains(event.target)))syncSlash();
  },true);
  document.addEventListener("keyup",event=>{
    const composer=localComposer();
    if(composer&&(composer===event.target||composer.contains(event.target)))syncSlash();
  },true);
  observer=new MutationObserver(scheduleScan);
  const observeDocument=()=>{
    if(document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true});
    scheduleScan();
  };
  if(document.documentElement)observeDocument();
  else document.addEventListener("DOMContentLoaded",observeDocument,{once:true});
})();
