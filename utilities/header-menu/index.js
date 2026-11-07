/* Independent GPT Tweaks header menu; existing plus and slash entries remain. */
(() => {
  "use strict";
  if(globalThis.GPTTweaksHeaderMenu)return;
  globalThis.GPTTweaksHeaderMenu=true;
  const iconUrl=chrome.runtime.getURL("assets/gpt-tweaks.svg");
  const items=[
    {id:"github-source",label:"Attach Source Code"},
    {id:"copy-entire-chat",label:"Copy Chat"},
    {id:"session-handoff",label:"Session Handoff"}
  ];
  const utilities=globalThis.__gptTweaksMenus;
  let trigger=null,menu=null,queued=false,activeIndex=-1;
  function rows(){return menu?[...menu.querySelectorAll('[role="menuitem"]')]:[];}
  function select(index){
    const entries=rows();
    if(index<0||index>=entries.length)return;
    activeIndex=index;
    for(const [i,row] of entries.entries()){
      if(i===index){
        row.dataset.gtgActive="true";
        row.setAttribute("data-highlighted","");
        row.classList.add("bg-secondary-ghost-hover");
        row.tabIndex=0;
      }else{
        row.removeAttribute("data-gtg-active");
        row.removeAttribute("data-highlighted");
        row.classList.remove("bg-secondary-ghost-hover");
        row.tabIndex=-1;
      }
    }
    entries[index].focus({preventScroll:true});
  }
  // Match the captured ChatGPT chat-actions dropdown, rather than supplying
  // independent icons, layout, colors, or hover values.
  const menuClasses="no-drag z-50 m-px flex select-none flex-col overflow-y-auto "+
    "bg-surface-elevated-secondary/90 text-default ring-(--color-border-overlay) "+
    "ring-(length:--dropdown-overlay-ring-width) shadow-(--shadow-dropdown-overlay) "+
    "backdrop-blur-sm rounded-2xl p-[var(--app-menu-gutter,var(--spacing))] "+
    "min-w-[var(--app-menu-min-width,220px)]";
  const rowClasses="no-drag itemBase-Uk8vyp rounded-xl text-default group "+
    "itemInteractive-A3p9wI flex flex-col cursor-interaction "+
    "hover:bg-secondary-ghost-hover focus-visible:bg-secondary-ghost-hover";
  function menuRow(item){
    const row=document.createElement("div");
    row.className=rowClasses;
    row.setAttribute("role","menuitem");
    row.setAttribute("data-orientation","vertical");
    row.tabIndex=-1;
    row.dataset.gtgHeaderAction=item.id;
    const content=document.createElement("div");
    content.className="flex w-full min-w-0 items-center "+
      "gap-[var(--spacing-menu-item-content,calc(var(--spacing)*1.5))]";
    content.dataset.menuRowContent="true";
    const body=document.createElement("span");
    body.className="flex-1 min-w-0 truncate";
    const inner=document.createElement("span");
    inner.className="flex w-full items-center gap-1.5";
    const iconSlot=document.createElement("span");
    iconSlot.className="inline-flex flex-none items-center justify-center size-(--icon-leading-size)";
    iconSlot.dataset.leadingIconSlot="menu";
    const icon=utilities.icon(item.id,16);
    if(!icon)throw Error("Missing registered GPT Tweaks icon: "+item.id);
    icon.classList.add("icon-sm","shrink-0");
    iconSlot.append(icon);
    const label=document.createElement("span");
    label.className="truncate";
    label.textContent=item.label;
    inner.append(iconSlot,label);
    body.append(inner);
    content.append(body);
    row.append(content);
    row.addEventListener("click",()=>act(item.id));
    return row;
  }
  function close(focus=false){
    if(!menu)return;
    menu.remove();menu=null;activeIndex=-1;
    trigger?.setAttribute("aria-expanded","false");
    if(trigger)trigger.dataset.state="closed";
    if(focus&&trigger?.isConnected)trigger.focus();
  }
  function act(id){
    close();
    try{
      const result=utilities.activate(id,"header");
      if(result?.catch)void result.catch(error=>console.warn("[GPT Tweaks] Header menu action failed",error));
    }catch(error){console.warn("[GPT Tweaks] Header menu action failed",error);}
  }
  function position(){
    if(!menu||!trigger?.isConnected)return;
    const rect=trigger.getBoundingClientRect(),width=menu.offsetWidth,height=menu.offsetHeight;
    menu.style.left=Math.max(8,Math.min(innerWidth-width-8,rect.right-width))+"px";
    const below=rect.bottom+8;
    menu.style.top=(below+height+8<=innerHeight?below:Math.max(8,rect.top-height-8))+"px";
  }
  function toggle(){
    if(menu){close();return;}
    menu=document.createElement("div");
    menu.id="gtg-header-menu";
    menu.className=menuClasses;
    menu.setAttribute("role","menu");
    menu.setAttribute("aria-orientation","vertical");
    menu.setAttribute("data-side","bottom");
    menu.setAttribute("data-align","end");
    menu.setAttribute("data-state","open");
    menu.setAttribute("aria-label","GPT Tweaks");
    try{
      for(const item of items)menu.append(menuRow(item));
    }catch(error){
      menu=null;
      console.warn("[GPT Tweaks] Unable to populate header menu",error);
      return;
    }
    // Mouse and keyboard both update the same selection. Neither owns a
    // separate highlight, and opening the menu never selects a row.
    const onHover=event=>{
      const row=event.target instanceof Element
        ?event.target.closest('[role="menuitem"]'):null;
      if(!row||!menu?.contains(row))return;
      const index=rows().indexOf(row);
      if(index!==activeIndex)select(index);
    };
    menu.addEventListener("pointerover",onHover);
    menu.addEventListener("pointermove",onHover);
    activeIndex=-1;
    document.body.append(menu);
    trigger.setAttribute("aria-expanded","true");trigger.dataset.state="open";
    position();
  }
  function mount(){
    const share=[...document.querySelectorAll('[data-app-shell-main-titlebar="true"] button[aria-label="Share"]')]
      .find(button=>button.getClientRects().length&&!button.closest('[aria-hidden="true"]'));
    const group=share?.parentElement;
    if(!group?.isConnected||!group.closest('[data-app-shell-main-titlebar="true"]')){
      close();trigger?.remove();trigger=null;return;
    }
    if(trigger?.isConnected&&trigger.parentElement===group&&trigger.nextElementSibling===share)return;
    close();trigger?.remove();
    // Share's existing group is the verified interactive toolbar area.
    // A separate cloned wrapper can sit behind the titlebar's pointer layer.
    trigger=share.cloneNode(false);trigger.removeAttribute("id");
    trigger.removeAttribute("aria-controls");
    // Share may be disabled during initial hydration; the extension must not
    // permanently inherit that transient state.
    trigger.disabled=false;
    trigger.removeAttribute("aria-disabled");
    trigger.removeAttribute("data-disabled");
    trigger.setAttribute("aria-label","GPT Tweaks");
    trigger.setAttribute("aria-haspopup","menu");
    trigger.setAttribute("aria-expanded","false");
    trigger.dataset.state="closed";
    trigger.dataset.gtgHeaderTrigger="true";
    const mark=document.createElement("span");
    mark.className="gtg-header-mark";
    mark.style.webkitMaskImage='url("'+iconUrl+'")';
    mark.style.maskImage='url("'+iconUrl+'")';
    const label=document.createElement("span");
    label.className="max-sm:hidden";
    label.textContent="GPT Tweaks";
    trigger.append(mark,label);
    group.insertBefore(trigger,share);
  }
  const onTrigger=event=>event.target instanceof Element&&
    event.target.closest('[data-gtg-header-trigger="true"]')===trigger;
  document.addEventListener("pointerdown",event=>{
    if(onTrigger(event)&&event.button===0){
      // Preserve the verified pointerdown activation; the cloned button
      // itself is no longer disabled by Share's transient hydration state.
      event.preventDefault();
      event.stopPropagation();
      toggle();
      return;
    }
    if(menu&&!menu.contains(event.target)&&!trigger?.contains(event.target))close();
  },true);
  // Never activate twice if a click follows the handled pointerdown.
  document.addEventListener("click",event=>{
    if(!onTrigger(event))return;
    event.preventDefault();
    event.stopPropagation();
  },true);
  document.addEventListener("keydown",event=>{
    if(menu){
      const count=rows().length;
      let next=null;
      if(event.key==="ArrowDown")next=activeIndex<0?0:(activeIndex+1)%count;
      else if(event.key==="ArrowUp")next=activeIndex<0?count-1:(activeIndex+count-1)%count;
      else if(event.key==="Home")next=0;
      else if(event.key==="End")next=count-1;
      if(next!==null){
        event.preventDefault();event.stopPropagation();
        if(count)select(next);
        return;
      }
      if(event.key==="Escape"){
        event.preventDefault();event.stopPropagation();
        close(true);return;
      }
      if(event.key==="Tab"){close();return;}
      if((event.key==="Enter"||event.key===" ")&&activeIndex>=0){
        event.preventDefault();event.stopPropagation();
        if(!event.repeat)act(items[activeIndex].id);
        return;
      }
    }
    if(onTrigger(event)&&(event.key==="Enter"||event.key===" ")){
      event.preventDefault();event.stopPropagation();
      if(!event.repeat)toggle();
    }
  },true);
  window.addEventListener("resize",position);
  window.addEventListener("scroll",position,true);
  function schedule(){
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{queued=false;mount();});
  }
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  mount();
})();
