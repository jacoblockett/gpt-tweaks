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
    const COMMAND=config.command;
    const COMMAND_TITLE=config.title;
    const ARCHIVE_DESCRIPTION=config.description;
    const utilityIcon=config.icon;
    const isEnabled=config.isEnabled;
    const launch=config.activate;
    const visible=el=>Boolean(el?.isConnected&&el.getClientRects().length);
    let slashSuggestion=null,slashAllowed=false,slashFeatureEnabled=null;
    function setMenuIcon(iconSlot){
      iconSlot.replaceChildren();
      for(const [size,klass] of [[16,"CompactSource-d7ZD01"],[20,"LeadingSource-d79mNZ"]]){
        const span=document.createElement("span");
        span.className=klass;span.setAttribute("aria-hidden","true");
        span.append(config.icon(size));iconSlot.append(span);
      }
    }
  function styleInjectedMenuRow(button){
    button.removeAttribute("aria-current");
    button.removeAttribute("aria-selected");
    button.classList.remove("bg-primary-ghost-hover","opacity-100");
    button.classList.add("menu-row-opacity");
    const active=()=>{button.classList.add("bg-primary-ghost-hover","opacity-100");button.classList.remove("menu-row-opacity");};
    const inactive=()=>{
      if(button.matches(":hover,:focus"))return;
      button.classList.remove("bg-primary-ghost-hover","opacity-100");
      button.classList.add("menu-row-opacity");
    };
    button.addEventListener("pointerenter",active);
    button.addEventListener("pointerleave",inactive);
    button.addEventListener("focus",active);
    button.addEventListener("blur",inactive);
  }

  // Menu sections remain React-owned. Decorations and injected buttons must not
  // impersonate React's data-list-navigation-item records.
  function removeMenuGroup(kind){
    for(const item of document.querySelectorAll('[data-gtg-menu-header="'+kind+'"],[data-gtg-menu-divider="'+kind+'"]'))
      item.remove();
  }
  function mountMenuGroup(section,button,kind){
    if(!section)return;
    const oldDivider=section.querySelector('[data-gtg-menu-divider="'+kind+'"]');
    if(oldDivider){oldDivider.before(button);return;}
    removeMenuGroup(kind);
    const heading=document.createElement("div");
    heading.className="gtg-menu-heading";
    heading.dataset.gtgMenuHeader=kind;
    heading.textContent="GPT Tweaks";
    heading.setAttribute("aria-hidden","true");
    const divider=document.createElement("div");
    divider.className="gtg-menu-divider";
    divider.dataset.gtgMenuDivider=kind;
    divider.setAttribute("role","separator");
    section.prepend(heading,button,divider);
  }
  function createMenuOption(reference){
    const element=reference.closest('button[data-list-navigation-item="true"]');
    const section=element?.closest('[data-mention-section-items="true"]');
    if(!section||!visible(element))return;
    if([...section.querySelectorAll('[data-gtg-menu-option="true"]')].some(row=>row.dataset.gtgUtilityId===config.id))return;

    // Clone the native row's entire layout, not just its outer button.
    // The captured ChatGPT menu uses these semantic data attributes for
    // the icon, label, description and menu-section parent.
    const button=element.cloneNode(true);
    for(const attr of ["id","aria-current","aria-selected","aria-haspopup","aria-expanded","data-state"])
      button.removeAttribute(attr);
    button.dataset.gtgMenuOption="true";
    button.dataset.gtgUtilityId=config.id;
    // React uses this DOM attribute for scroll indexes based on its own data array.
    button.removeAttribute("data-list-navigation-item");
    button.type="button";
    const content=button.querySelector('[data-menu-row-content="true"]');
    const label=content?.querySelector(':scope > span:last-child > span > span:first-child');
    const detail=content?.querySelector(':scope > span:last-child > span > span:last-child');
    const iconSlot=content?.querySelector('[data-leading-icon-slot="menu"]');
    if(!label||!detail||!iconSlot)return;
    label.textContent=COMMAND_TITLE;
    detail.textContent=ARCHIVE_DESCRIPTION;

    setMenuIcon(iconSlot);
    styleInjectedMenuRow(button);
    button.addEventListener("mousedown",event=>event.preventDefault());
    button.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      // Unlike a React-owned row, this injected button cannot close the
      // native menu through its internal onSelect callback.
      const trigger=document.querySelector('button[data-composer-navigation-target="add-context"][aria-expanded="true"]');
      trigger?.click();
      launch("menu");
    });
    mountMenuGroup(section,button,"menu");
    setVirtualRow(button);
  }
  async function scanMenu(){
    const labels=document.querySelectorAll('[data-mention-section-items="true"] > button[data-list-navigation-item="true"]');
    const native=[...labels].find(el=>visible(el)&&!el.dataset.gtgMenuOption&&
      (el.innerText||"").trim().toLowerCase().startsWith("add from library"));
    if(!native)return;
    try{
      const enabled=await isEnabled("menu");
      if(!native.isConnected)return;
      const existing=[...native.parentElement.querySelectorAll('[data-gtg-menu-option="true"]')].find(row=>row.dataset.gtgUtilityId===config.id);
      if(enabled)createMenuOption(native);
      else {
        existing?.remove();
        if(!native.parentElement.querySelector('[data-gtg-menu-option="true"]'))
          removeMenuGroup("menu");
      }
    }catch{}
  }
  function resetSlash(){
    slashAllowed=false;
    const owned=Boolean(slashSuggestion)||adapters.size===1;
    if(slashSuggestion){
      if(virtualRow===slashSuggestion)clearVirtualRow();
      slashSuggestion.remove();slashSuggestion=null;
    }
    if(owned){
      document.getElementById("gtg-command-fallback")?.remove();
      removeMenuGroup("slash");
    }
    slashRange=null;
  }
  // Search the visible title, never the slash command identifier.
  // A query is a case-insensitive in-order subsequence of the visible name.
  const fuzzyText=COMMAND_TITLE.toLowerCase();
  function fuzzyPositions(value){
    if(typeof value!=="string"||!/^\/[a-z-]*$/i.test(value))return null;
    const letters=value.slice(1).toLowerCase().replace(/-/g,"");
    if(value!=="/"&&!letters)return null;
    const positions=[];
    let cursor=0;
    for(const char of letters){
      const next=fuzzyText.indexOf(char,cursor);
      if(next<0)return null;
      positions.push(next);
      cursor=next+1;
    }
    return positions;
  }
  function displayFuzzyTitle(row,value){
    const label=row?.querySelector('[data-gtg-slash-title="true"]');
    if(!label||label.dataset.gtgFuzzyQuery===value)return;
    label.dataset.gtgFuzzyQuery=value;
    const positions=fuzzyPositions(value)||[];
    // A lone slash opens the command menu; it does not start a fuzzy search.
    row.dataset.gtgFuzzyActive=positions.length?"true":"false";
    if(!positions.length){
      label.textContent=COMMAND_TITLE;
      return;
    }
    const active=new Set(positions);
    const parts=[];
    for(let i=0;i<COMMAND_TITLE.length;i++){
      const letter=document.createElement("span");
      if(active.has(i))letter.className="gtg-fuzzy-match";
      letter.textContent=COMMAND_TITLE[i];
      parts.push(letter);
    }
    label.replaceChildren(...parts);
  }
  function makeFallbackSuggestion(){
    const container=document.createElement("div");
    container.id="gtg-command-fallback";
    container.className="gtg-command-fallback";
    container.setAttribute("role","presentation");
    const heading=document.createElement("div");
    heading.className="gtg-menu-heading";
    heading.textContent="GPT Tweaks";
    const row=document.createElement("button");
    row.id="gtg-slash";
    row.type="button";
    row.dataset.gtgSlash="true";
    row.dataset.gtgUtilityId=config.id;
    row.className="gtg-fallback-row";
    const icon=document.createElement("span");
    icon.className="gtg-fallback-icon";
    icon.append(utilityIcon(20));
    const textBox=document.createElement("span");
    textBox.className="gtg-fallback-text";
    const title=document.createElement("span");
    title.dataset.gtgSlashTitle="true";
    const detail=document.createElement("span");
    detail.className="gtg-fallback-description";
    detail.textContent=ARCHIVE_DESCRIPTION;
    textBox.append(title,detail);
    row.append(icon,textBox);
    container.append(heading,row);
    document.body.append(container);
    const composer=localComposer();
    if(composer){
      const rect=composer.closest("form")?.getBoundingClientRect()||composer.getBoundingClientRect();
      container.style.left=Math.max(8,rect.left)+"px";
      container.style.width=Math.min(rect.width,window.innerWidth-16)+"px";
      container.style.bottom=Math.max(8,window.innerHeight-rect.top+8)+"px";
    }
    return row;
  }
  let slashRange=null;
  // Match only a slash token directly before the caret, not the whole composer.
  // This works for commands after existing text without deleting that text.
  function composerSlashMatch(composer=localComposer()){
    const selection=window.getSelection();
    if(!composer||!selection||!selection.rangeCount||!selection.isCollapsed||
       !composer.contains(selection.anchorNode))return null;
    const caret=selection.getRangeAt(0);
    const prefix=document.createRange();
    prefix.selectNodeContents(composer);
    prefix.setEnd(caret.endContainer,caret.endOffset);
    const text=prefix.toString();
    const match=text.match(/(?:^|[\s\u00a0])(\/[a-z-]*)$/i);
    if(!match||fuzzyPositions(match[1])===null)return null;
    const target=text.length-match[1].length;
    const walker=document.createTreeWalker(composer,NodeFilter.SHOW_TEXT);
    const probe=document.createRange();
    probe.selectNodeContents(composer);
    let node;
    while((node=walker.nextNode())){
      probe.setEnd(node,node.textContent.length);
      if(probe.toString().length<target)continue;
      let left=0,right=node.textContent.length;
      while(left<right){
        const middle=Math.floor((left+right)/2);
        probe.setEnd(node,middle);
        if(probe.toString().length<target)left=middle+1;
        else right=middle;
      }
      probe.setEnd(node,left);
      if(probe.toString().length!==target)return null;
      const deletion=document.createRange();
      deletion.setStart(node,left);
      deletion.setEnd(caret.endContainer,caret.endOffset);
      if(deletion.toString()!==match[1])return null;
      return {value:match[1],range:deletion};
    }
    return null;
  }
  async function updateSlash(){
    const composer=localComposer();
    const match=composerSlashMatch(composer);
    if(!match){
      resetSlash();return;
    }
    slashRange=match.range.cloneRange();
    // Prefer ChatGPT's real popup once it becomes available, but retain the
    // one-item fallback when native slash filtering returns no results.
    const nativeAvailable=[...document.querySelectorAll('[data-mention-section-id="commands"] [data-mention-section-items="true"] > button[data-list-navigation-item="true"]')]
      .some(el=>visible(el));
    const wasFallback=Boolean(document.getElementById("gtg-command-fallback"));
    if(slashSuggestion?.isConnected&&
       ((wasFallback&&nativeAvailable)||!visible(slashSuggestion))){
      if(virtualRow===slashSuggestion)clearVirtualRow();
      slashSuggestion.remove();
      slashSuggestion=null;
      document.getElementById("gtg-command-fallback")?.remove();
      removeMenuGroup("slash");
    }
    if(slashSuggestion?.isConnected){
      const title=slashSuggestion.querySelector('[data-gtg-slash-title="true"]');
      const queryChanged=title?.dataset.gtgFuzzyQuery!==match.value;
      displayFuzzyTitle(slashSuggestion,match.value);
      // React may still select its first native row after filtering.
      // Reassert the injected top row only on a new search query, so ordinary
      // pointer and arrow navigation at a stable query is not overridden.
      if(queryChanged)setVirtualRow(slashSuggestion);
      return;
    }
    try{
      const enabled=await isEnabled("slash");
      slashFeatureEnabled=enabled;
      if(!enabled){resetSlash();return;}
      slashAllowed=true;
    }catch{slashAllowed=false;return;}
    const current=composerSlashMatch();
    if(!current||slashSuggestion?.isConnected)return;
    slashRange=current.range.cloneRange();
    const rows=[...document.querySelectorAll('[data-mention-section-id="commands"] [data-mention-section-items="true"] > button[data-list-navigation-item="true"]')]
      .filter(el=>visible(el)&&!el.dataset.gtgSlash);
    const native=rows.find(el=>!el.hasAttribute("aria-current"))||rows[0];
    slashSuggestion=native?native.cloneNode(true):makeFallbackSuggestion();
    slashSuggestion.type="button";
    slashSuggestion.id="gtg-slash";
    slashSuggestion.dataset.gtgSlash="true";
    slashSuggestion.dataset.gtgUtilityId=config.id;
    // Do not shift native React's scroll indexes with an unregistered row.
    slashSuggestion.removeAttribute("data-list-navigation-item");
    styleInjectedMenuRow(slashSuggestion);
    if(native){
      const menuLabel=slashSuggestion.querySelector(':scope > div > div > div > div');
      const menuDesc=slashSuggestion.querySelector(':scope > div > div > div > span');
      if(!menuLabel||!menuDesc){
        slashSuggestion=null;
        return;
      }
      menuLabel.dataset.gtgSlashTitle="true";
      menuDesc.textContent=ARCHIVE_DESCRIPTION;
      const icon=slashSuggestion.querySelector('[data-leading-icon-slot="menu"]');
      // The available native command might be a submenu (e.g. Model).
      // Its trailing chevron must never be inherited by our action row.
      for(const arrow of slashSuggestion.querySelectorAll("svg")){
        if(icon?.contains(arrow))continue;
        const parent=arrow.parentElement;
        arrow.remove();
        if(parent&&parent!==slashSuggestion&&
           !parent.textContent.trim()&&!parent.querySelector("svg,button,input"))
          parent.remove();
      }
      if(icon)setMenuIcon(icon);
      mountMenuGroup(native.parentElement,slashSuggestion,"slash");
    }
    displayFuzzyTitle(slashSuggestion,current.value);
    setVirtualRow(slashSuggestion);
    slashSuggestion.addEventListener("mousedown",event=>event.preventDefault());
    slashSuggestion.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){
        event.preventDefault();event.stopPropagation();
        clearComposerCommand();launch("slash");
      }
    });
    slashSuggestion.addEventListener("click",event=>{
      event.preventDefault();event.stopPropagation();clearComposerCommand();launch("slash");
    });
  }
  function clearComposerCommand(){
    const composer=localComposer();
    // A menu click can shift focus, so retain the exact command range captured
    // while typing. Never select or replace the rest of the ProseMirror document.
    const range=slashRange?.cloneRange();
    if(composer&&range&&composer.contains(range.commonAncestorContainer)&&
       fuzzyPositions(range.toString())!==null){
      composer.focus();
      const selection=window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("delete",false);
    }
    resetSlash();
  }
  // ChatGPT's suggestion list is React-managed. This narrow adapter makes the
  // external row reachable by arrow keys without claiming an index in that list.
  // It yields ordinary item transitions to React and intercepts only the extra slot.
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
  function handleDirectEnter(event){
    if(event.key!=="Enter"||event.shiftKey||event.isComposing||
       event.ctrlKey||event.metaKey||event.altKey||event.defaultPrevented)return;
    const composer=localComposer();
    if(!composer||!composer.contains(event.target))return;
    const match=composerSlashMatch(composer);
    if(!match||slashFeatureEnabled===false)return;
    // The displayed title determines matching and activation, so /attach is
    // actionable even if React has filtered away its own commands popup.
    event.preventDefault();
    event.stopImmediatePropagation();
    const expected=match.value;
    const captured=match.range.cloneRange();
    const activate=()=>{
      if(localComposer()!==composer||!composer.contains(captured.commonAncestorContainer)||
         captured.toString()!==expected)return;
      slashRange=captured.cloneRange();
      clearComposerCommand();
      launch("slash");
    };
    if(slashFeatureEnabled===true){
      activate();
    }else{
      isEnabled("slash").then(enabled=>{
        slashFeatureEnabled=enabled;
        if(enabled)activate();
      }).catch(()=>{});
    }
  }
  function hasSlashMatch(){return Boolean(composerSlashMatch());}
  function scan(){
    void scanMenu();
    if(slashSuggestion&&!slashSuggestion.isConnected)slashSuggestion=null;
  }
    return {resetSlash,scan,updateSlash,hasSlashMatch,handleDirectEnter,interceptMenuKey,
      isOpen:()=>Boolean(config.isOpen?.())};
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
