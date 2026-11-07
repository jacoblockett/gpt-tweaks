(() => {
  "use strict";
  if(globalThis.__gptTweaksNewChatInitialized)return;
  globalThis.__gptTweaksNewChatInitialized=true;

  let preferences=null,loading=null,invalidated=false;
  function reportError(label,error) {
    // Existing tabs can retain the previous content script after an extension
    // update or reload. That script cannot communicate with the new worker.
    if(/Extension context invalidated/i.test(String(error?.message||error))){
      invalidated=true;
      preferences=null;
      return;
    }
    console.warn("[GPT Tweaks] "+label,error);
  }
  function refresh() {
    if(invalidated)return Promise.resolve(null);
    if(loading)return loading;
    try {
      loading=Promise.resolve(chrome.runtime.sendMessage({type:"gpt-tweaks:new-chat:preferences"}))
        .then(result=>{
          preferences=result?.ok?result.data:null;
          return preferences;
        })
        .catch(error=>{
          preferences=null;
          reportError("New chat settings unavailable:",error);
          return null;
        })
        .finally(()=>{loading=null;});
    } catch(error) {
      preferences=null;
      reportError("New chat settings unavailable:",error);
      return Promise.resolve(null);
    }
    return loading;
  }
  function enabled(method) {
    return method==="middle"&&preferences?.enabled===true;
  }
  function open(method,projectId=null) {
    if(!enabled(method)||invalidated)return;
    try {
      void Promise.resolve(chrome.runtime.sendMessage({
        type:"gpt-tweaks:new-chat:open",method,pathname:location.pathname,
        ...(projectId?{projectId}:{})
      })).then(result=>{
        if(!result?.ok)console.warn("[GPT Tweaks] Unable to open new chat:",result?.error);
      }).catch(error=>reportError("Unable to open new chat:",error));
    } catch(error) {
      reportError("Unable to open new chat:",error);
    }
  }

  // Native New chat controls exist in the sidebar, project rows, and
  // responsive header. Project rows carry an explicit project ID.
  function newChatTarget(target) {
    if(!(target instanceof Element))return null;
    const button=target.closest("button");
    if(!button||!button.closest('#app-shell-sidebar,[data-app-shell-titlebar]'))return null;
    const label=button.getAttribute("aria-label");
    // The expanded sidebar's main New chat button has visible text, not an aria-label.
    const expandedNewChat=!label&&
      !!button.closest('[data-sidebar-navigation-root="true"] nav[aria-label="Chat history"] > div:first-child')&&
      button.textContent?.trim()==="New chat";
    // Project New chat buttons are siblings of the project title row.
    // Their shared container carries "project:<id>" in the captured DOM.
    const projectContainer=button.closest('[data-sidebar-project-container-id^="project:"]');
    const projectId=projectContainer?.getAttribute("data-sidebar-project-container-id")?.slice(8)||null;
    if(label!=="New chat"&&!expandedNewChat&&!(label?.startsWith("New chat in ")&&projectId))return null;
    return {projectId};
  }
  function onMiddleClick(event) {
    if(event.button!==1||!enabled("middle"))return;
    const target=newChatTarget(event.target);
    if(!target)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(event.type==="auxclick")open("middle",target.projectId);
  }
  document.addEventListener("mousedown",onMiddleClick,true);
  document.addEventListener("auxclick",onMiddleClick,true);
  window.addEventListener("focus",()=>{void refresh();});
  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden)void refresh();
  });
  void refresh();


})();
