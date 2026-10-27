(() => {
"use strict";
globalThis.__gptTweaksSlashMenu=(config,helpers)=>{
const {visible,localComposer,setMenuIcon,styleInjectedMenuRow,mountMenuGroup,removeMenuGroup,
setVirtualRow,clearVirtualRow,isVirtualRow,countUtilities}=helpers;
const COMMAND_TITLE=config.title,ARCHIVE_DESCRIPTION=config.description;
const utilityIcon=config.icon,isEnabled=config.isEnabled,launch=config.activate;
let slashSuggestion=null,slashAllowed=false,slashFeatureEnabled=null;
  function resetSlash(){
    slashAllowed=false;
    const owned=!!slashSuggestion||countUtilities()===1;
    if(slashSuggestion){
      if(isVirtualRow(slashSuggestion))clearVirtualRow();
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
    const wasFallback=document.getElementById("gtg-command-fallback") !== null;
    if(slashSuggestion?.isConnected&&
       ((wasFallback&&nativeAvailable)||!visible(slashSuggestion))){
      if(isVirtualRow(slashSuggestion))clearVirtualRow();
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
  function hasSlashMatch(){return !!composerSlashMatch();}

function ensureConnected(){if(slashSuggestion&&!slashSuggestion.isConnected)slashSuggestion=null;}
return {resetSlash,updateSlash,hasSlashMatch,handleDirectEnter,ensureConnected};
};
})();