(() => {
  "use strict";
  function setupDropdownScrollbars(dialog) {
    const panels=[...dialog.querySelectorAll(".gtg-options,.gtg-revision-list")];
    const states=panels.map(panel=>({panel,hover:false,dragging:false,scrolling:false,timer:null}));
    const controller=new AbortController();
    const refresh=state=>{
      state.panel.classList.toggle("gtg-scrollbar-visible",
        state.hover||state.dragging||state.scrolling);
    };
    const overGutter=(panel,event)=>{
      if(!panel.getClientRects().length||panel.scrollHeight<=panel.clientHeight+1)return false;
      const rect=panel.getBoundingClientRect();
      return event.clientX>=rect.right-12&&event.clientX<=rect.right&&
        event.clientY>=rect.top&&event.clientY<=rect.bottom;
    };
    // Listen above the individual rows so the invisible native scrollbar gutter
    // responds without showing the thumb when hovering the rest of the list.
    const trackPointer=event=>{
      for(const state of states){
        state.hover=event.pointerType==="mouse"&&overGutter(state.panel,event);
        refresh(state);
      }
    };
    document.addEventListener("pointermove",trackPointer,
      {capture:true,passive:true,signal:controller.signal});
    document.addEventListener("pointerdown",event=>{
      trackPointer(event);
      if(event.button!==0)return;
      for(const state of states){
        if(state.hover){state.dragging=true;refresh(state);}
      }
    },{capture:true,passive:true,signal:controller.signal});
    const release=event=>{
      for(const state of states)state.dragging=false;
      trackPointer(event);
    };
    document.addEventListener("pointerup",release,
      {capture:true,passive:true,signal:controller.signal});
    document.addEventListener("pointercancel",release,
      {capture:true,passive:true,signal:controller.signal});
    window.addEventListener("blur",()=>{
      for(const state of states){
        state.dragging=false;state.hover=false;refresh(state);
      }
    },{signal:controller.signal});
    for(const state of states){
      state.panel.addEventListener("scroll",()=>{
        state.scrolling=true;refresh(state);
        clearTimeout(state.timer);
        state.timer=setTimeout(()=>{
          state.scrolling=false;refresh(state);
        },800);
      },{passive:true,signal:controller.signal});
    }
    dialog.addEventListener("close",()=>{
      controller.abort();
      for(const state of states)clearTimeout(state.timer);
    },{once:true});
  }

  globalThis.__gptTweaksDropdownScrollbars=setupDropdownScrollbars;
})();
