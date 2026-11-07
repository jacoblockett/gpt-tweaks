/* Independent GPT Tweaks header menu; existing plus and slash entries remain. */
(() => {
  "use strict";
  if(globalThis.GPTTweaksHeaderMenu)return;
  globalThis.GPTTweaksHeaderMenu=true;
  const iconUrl=chrome.runtime.getURL("assets/gpt-tweaks.svg");
  const items=[
    {key:"copy",label:"Copy Chat",paths:["M7 6.5h7.5a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z","M5 13h-.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2H12a2 2 0 0 1 2 2v1.5"],box:"0 0 21 21"},
    {key:"handoff",label:"Session Handoff",paths:["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z","M14 2v6h6","M8 13h8","m13 10 3 3-3 3"]},
    {key:"source",label:"Attach Source Code",paths:["m16 18 6-6-6-6","m8 6-6 6 6 6"]}
  ];
  let trigger=null,menu=null,queued=false;
  function icon(item){
    const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
    for(const [name,value] of Object.entries({width:"18",height:"18",viewBox:item.box||"0 0 24 24",
      fill:"none",stroke:"currentColor","stroke-width":"1.8","stroke-linecap":"round",
      "stroke-linejoin":"round","aria-hidden":"true"}))svg.setAttribute(name,value);
    for(const d of item.paths){const path=document.createElementNS(ns,"path");path.setAttribute("d",d);svg.append(path);}
    return svg;
  }
  function close(focus=false){
    if(!menu)return;
    menu.remove();menu=null;
    trigger?.setAttribute("aria-expanded","false");
    if(trigger)trigger.dataset.state="closed";
    if(focus&&trigger?.isConnected)trigger.focus();
  }
  function act(key){
    close();
    try{
      const calls={
        copy:()=>globalThis.GPTTweaksEnhancedCopy?.activate("header"),
        handoff:()=>globalThis.GPTTweaksHandoff?.activate("header"),
        source:()=>globalThis.__gptTweaksGitHubSourceUI?.launch("header")
      };
      const result=calls[key]?.();
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
    menu.id="gtg-header-menu";menu.setAttribute("role","menu");
    menu.setAttribute("aria-label","GPT Tweaks");
    for(const item of items){
      const button=document.createElement("button");
      button.type="button";button.className="gtg-header-item";
      button.setAttribute("role","menuitem");button.dataset.gtgHeaderAction=item.key;
      button.append(icon(item),document.createTextNode(item.label));
      button.addEventListener("click",()=>act(item.key));
      menu.append(button);
    }
    menu.addEventListener("keydown",event=>{
      const entries=[...menu.querySelectorAll('[role="menuitem"]')];
      const current=entries.indexOf(document.activeElement);
      let next=-1;
      if(event.key==="ArrowDown")next=(current+1)%entries.length;
      else if(event.key==="ArrowUp")next=(current+entries.length-1)%entries.length;
      else if(event.key==="Home")next=0;
      else if(event.key==="End")next=entries.length-1;
      else if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close(true);return;}
      else if(event.key==="Tab"){close();return;}
      if(next>=0){event.preventDefault();event.stopPropagation();entries[next].focus();}
    });
    document.body.append(menu);
    trigger.setAttribute("aria-expanded","true");trigger.dataset.state="open";
    position();menu.querySelector('[role="menuitem"]')?.focus();
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
    trigger.setAttribute("aria-label","GPT Tweaks");
    trigger.setAttribute("aria-haspopup","menu");
    trigger.setAttribute("aria-expanded","false");
    trigger.dataset.state="closed";
    trigger.dataset.gtgHeaderTrigger="true";
    const mark=document.createElement("span");
    mark.className="gtg-header-mark";
    mark.style.webkitMaskImage='url("'+iconUrl+'")';
    mark.style.maskImage='url("'+iconUrl+'")';
    trigger.append(mark,document.createTextNode("GPT Tweaks"));
    group.insertBefore(trigger,share);
  }
  const onTrigger=event=>event.target instanceof Element&&
    event.target.closest('[data-gtg-header-trigger="true"]')===trigger;
  document.addEventListener("pointerdown",event=>{
    if(onTrigger(event)&&event.button===0){
      // ChatGPT can replace its React-owned toolbar between pointerdown
      // and click. Handle the event proven to reach the injected button.
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
    if(onTrigger(event)&&(event.key==="Enter"||event.key===" ")){
      event.preventDefault();
      event.stopPropagation();
      if(!event.repeat)toggle();
      return;
    }
    if(menu&&event.key==="Escape"&&!menu.contains(event.target))close();
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
