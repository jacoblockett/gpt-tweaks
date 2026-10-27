(() => {
  "use strict";
  if(globalThis.__gptTweaksMenus)return;
  const adapters=new Map();
  let observer=null,scanQueued=false,scanTimer=null,virtualRow=null;
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
    adapters.set(config.id,createAdapter(config));
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
    const plus=globalThis.__gptTweaksPlusMenu(config,{visible,setMenuIcon,setVirtualRow});
    const slash=globalThis.__gptTweaksSlashMenu(config,{
      visible,localComposer,setMenuIcon,styleInjectedMenuRow:plus.styleInjectedMenuRow,
      mountMenuGroup:plus.mountMenuGroup,removeMenuGroup:plus.removeMenuGroup,
      setVirtualRow,clearVirtualRow,isVirtualRow:row=>virtualRow===row,
      countUtilities:()=>adapters.size
    });
  function injectedNeighbor(row,direction){
    let next=row;
    for(;;){
      next=direction<0?next.previousElementSibling:next.nextElementSibling;
      if(!next)return null;
      if(next.matches('button[data-gtg-menu-option="true"],#gtg-slash'))return next;
      if(next.matches('button[data-list-navigation-item="true"]'))return null;
    }
  }
  function nativeNeighbor(row,direction){
    let node=row;
    for(;;){
      node=direction<0?node.previousElementSibling:node.nextElementSibling;
      if(!node)return null;
      if(node.matches('button[data-list-navigation-item="true"]'))return node;
    }
  }
  function interceptMenuKey(event){
    if([...adapters.values()].some(adapter=>adapter.isOpen())||
       event.isComposing||event.altKey||event.metaKey||event.ctrlKey)return;
    const active=[...document.querySelectorAll('[data-gtg-menu-option="true"],#gtg-slash')]
      .filter(row=>visible(row));
    const registered=active.filter(row=>row.dataset.gtgUtilityId===config.id);
    if(registered.length!==1){
      if(virtualRow?.dataset.gtgUtilityId===config.id)clearVirtualRow();
      return;
    }
    const row=registered[0];
    if(virtualRow&&virtualRow.dataset.gtgUtilityId!==config.id)return;
    if(virtualRow&&virtualRow!==row)clearVirtualRow();
    const parent=row.parentElement;
    const prev=nativeNeighbor(row,-1),next=nativeNeighbor(row,1);
    if(!parent)return;
    if(!prev&&!next&&row.id!=="gtg-slash")return;
    const nativeRows=[...parent.querySelectorAll(':scope > button[data-list-navigation-item="true"]')];
    const nativeSelected=nativeRows.find(node=>node.getAttribute("aria-current")==="true") ||
      nativeRows.find(node=>node.classList.contains("bg-primary-ghost-hover"));
    if(event.key==="Escape"){clearVirtualRow();return;}
    if(virtualRow===row){
      if(event.key==="Enter"||event.key==="Tab"||event.key===" "){
        event.preventDefault();event.stopImmediatePropagation();
        clearVirtualRow();row.click();return;
      }
      if(event.key==="ArrowDown"||event.key==="ArrowUp"){
        const direction=event.key==="ArrowDown"?1:-1;
        const nextInjected=injectedNeighbor(row,direction);
        if(nextInjected){
          event.preventDefault();event.stopImmediatePropagation();
          setVirtualRow(nextInjected);
          return;
        }
        if(!nativeRows.length){
          event.preventDefault();event.stopImmediatePropagation();
          return;
        }
        // React is still highlighting the adjacent item from which we entered.
        // Let its original handler advance across the boundary in that direction.
        const letNativeAdvance=direction===1&&nativeSelected===prev ||
          direction===-1&&nativeSelected===next;
        clearVirtualRow();
        if(!letNativeAdvance){
          event.preventDefault();event.stopImmediatePropagation();
        }
        return;
      }
      // Text editing, Backspace, etc. should not deselect the first result.
      // updateSlash() clears the selection when the new query stops matching.
      return;
    }
    if((event.key==="ArrowDown"&&nativeSelected===prev)||
       (event.key==="ArrowUp"&&nativeSelected===next)){
      event.preventDefault();event.stopImmediatePropagation();
      setVirtualRow(row);
    }
  }
    function scan(){void plus.scanMenu();slash.ensureConnected();}
    return {scan,resetSlash:slash.resetSlash,updateSlash:slash.updateSlash,
      hasSlashMatch:slash.hasSlashMatch,handleDirectEnter:slash.handleDirectEnter,
      interceptMenuKey,isOpen:()=>!!config.isOpen?.()};
  }
  function selectedSlashAdapter(){
    for(const adapter of adapters.values())
      if(adapter.hasSlashMatch())return adapter;
    return null;
  }
  function syncSlash(){
    const chosen=selectedSlashAdapter();
    for(const adapter of adapters.values()){
      if(adapter!==chosen)adapter.resetSlash();
    }
    if(chosen)void chosen.updateSlash();
  }
  function scanAll(){
    scanQueued=false;
    for(const adapter of adapters.values())adapter.scan();
    syncSlash();
  }
  function scheduleScan(){
    if(!scanQueued){scanQueued=true;scanTimer=setTimeout(scanAll,100);}
  }
  // All registered utilities share one ChatGPT mutation observer and
  // one copy of the keyboard/focus listeners.
  window.addEventListener("keydown",event=>{
    for(const adapter of adapters.values()){
      if(event.defaultPrevented)break;
      adapter.interceptMenuKey(event);
    }
  },true);
  document.addEventListener("mousemove",event=>{
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
