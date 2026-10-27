(() => {
  "use strict";
  if(globalThis.__gptTweaksMenus)return;
  const adapters=new Map();
  let observer=null,scanQueued=false,scanTimer=null,virtualRow=null;
  let plusRoot=null,plusSelected=null,plusIndex=0,plusTouched=false;
  function clearVirtualRow(){
    if(!virtualRow)return;
    const row=virtualRow;
    virtualRow=null;
    delete row.dataset.gtgVirtualHighlight;
    if(!row.matches(":hover,:focus")){
      row.classList.remove("bg-primary-ghost-hover","opacity-100");
      row.classList.add("menu-row-opacity");
    }
  }
  function setVirtualRow(row){
    clearVirtualRow();
    virtualRow=row;
    row.dataset.gtgVirtualHighlight="true";
    row.classList.remove("menu-row-opacity");
    row.classList.add("bg-primary-ghost-hover","opacity-100");
  }

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
      setVirtualRow,clearVirtualRow,isVirtualRow:row=>virtualRow===row,
      countUtilities:()=>adapters.size
    });
    function scan(){void plus.scanMenu();slash.ensureConnected();}
    return {scan,resetSlash:slash.resetSlash,updateSlash:slash.updateSlash,
      hasSlashMatch:slash.hasSlashMatch,handleDirectEnter:slash.handleDirectEnter,
      isOpen:()=>!!config.isOpen?.()};
  }
  const visibleRow=row=>!!(row?.isConnected&&row.getClientRects().length);
  const plusSelector='button[data-gtg-menu-option="true"]';
  const injectedSelector='button[data-gtg-menu-option="true"],button[data-gtg-slash="true"]';
  const nativeSelector='button[data-list-navigation-item="true"]';

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

  // ChatGPT owns native menu selection. Treat its visible rows and our
  // injected rows as one cyclic list while leaving native-to-native keys to
  // React. No synthetic React list indexes or reimplemented native menus.
  function interceptMenuKey(event){
    if(event.defaultPrevented)return;
    if(interceptPlusKey(event))return;
    if(event.isComposing||event.altKey||event.metaKey||
       event.ctrlKey||[...adapters.values()].some(adapter=>adapter.isOpen()))return;
    const key=event.key;
    if(key!=="ArrowUp"&&key!=="ArrowDown"&&key!=="Enter"&&key!=="Tab"&&key!==" "&&key!=="Escape")return;

    const injected=[...document.querySelectorAll('button[data-gtg-slash="true"]')].filter(visibleRow);
    if(!injected.length)return;
    if(virtualRow&&!injected.includes(virtualRow))clearVirtualRow();
    const section=(virtualRow||injected[0]).parentElement;
    if(!section)return;
    const buttons=[...section.children].filter(button=>visibleRow(button)&&button.matches('button'));
    const utilities=buttons.filter(button=>button.matches(injectedSelector));
    if(!utilities.length)return;
    const native=[...section.querySelectorAll(nativeSelector)].filter(visibleRow);
    const active=utilities.includes(virtualRow)?virtualRow:null;
    const nativeSelected=native.find(row=>row===document.activeElement)||
      native.find(row=>row.getAttribute("aria-current")==="true")||
      native.find(row=>row.classList.contains("bg-primary-ghost-hover"));
    if(key==="Escape"){clearVirtualRow();return;}
    if(active&&(key==="Enter"||key==="Tab"||key===" ")){
      event.preventDefault();event.stopImmediatePropagation();
      clearVirtualRow();active.click();return;
    }
    if(key!=="ArrowUp"&&key!=="ArrowDown")return;
    const forward=key==="ArrowDown";
    const choose=row=>{
      event.preventDefault();event.stopImmediatePropagation();
      setVirtualRow(row);
    };
    if(active){
      const index=utilities.indexOf(active);
      const next=utilities[index+(forward?1:-1)];
      if(next){choose(next);return;}
      if(!native.length){
        choose(forward?utilities[0]:utilities[utilities.length-1]);
        return;
      }
      // Crossing to the native edge can happen from either native anchor:
      // keep the already-selected destination, or let React wrap there.
      const destination=forward?native[0]:native[native.length-1];
      if(nativeSelected===destination){
        event.preventDefault();event.stopImmediatePropagation();
      }
      clearVirtualRow();
      return;
    }
    if(!nativeSelected)return;
    // Below the last native item comes our first item. Above the first
    // native item comes our last item. Internal native movement is untouched.
    if(forward&&nativeSelected===native[native.length-1])choose(utilities[0]);
    else if(!forward&&nativeSelected===native[0])choose(utilities[utilities.length-1]);
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
    }).catch(error=>console.warn("[GPT Tweaks] Slash menu sync failed:",error));
  }
  function scanAll(){
    scanQueued=false;
    for(const adapter of adapters.values())adapter.scan();
    syncPlus();
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
  document.addEventListener('mousemove',event=>{
    onPlusHover(event);
    if(!virtualRow)return;
    const hovered=event.target instanceof Element?
      event.target.closest('button[data-list-navigation-item="true"]'):null;
    if(hovered)clearVirtualRow();
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
