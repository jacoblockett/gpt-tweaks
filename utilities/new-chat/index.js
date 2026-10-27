(() => {
  "use strict";
  if(globalThis.GPTTweaksNewChat)return;

  let preferences=null,loading=null;
  function refresh() {
    if(loading)return loading;
    loading=chrome.runtime.sendMessage({type:"gpt-tweaks:new-chat:preferences"})
      .then(result=>{
        preferences=result?.ok?result.data:null;
        return preferences;
      })
      .catch(error=>{
        preferences=null;
        console.warn("[GPT Tweaks] New chat settings unavailable:",error);
        return null;
      }).finally(()=>{loading=null;});
    return loading;
  }
  function enabled(method) {
    return !!(preferences?.enabled&&preferences[method]);
  }
  function open(method,projectId=null) {
    if(!enabled(method))return;
    void chrome.runtime.sendMessage({
      type:"gpt-tweaks:new-chat:open",method,pathname:location.pathname,
      ...(projectId?{projectId}:{})
    }).then(result=>{
      if(!result?.ok)console.warn("[GPT Tweaks] Unable to open new chat:",result?.error);
    }).catch(error=>console.warn("[GPT Tweaks] Unable to open new chat:",error));
  }

  // Native New chat controls exist in the sidebar, project rows, and
  // responsive header. Project rows carry an explicit project ID.
  function newChatTarget(target) {
    if(!(target instanceof Element))return null;
    const button=target.closest('button[aria-label="New chat"],button[aria-label^="New chat in "]');
    if(!button||!button.closest('#app-shell-sidebar,[data-app-shell-titlebar]'))return null;
    const projectRow=button.closest('[data-app-action-sidebar-project-id]');
    if(button.getAttribute("aria-label")!=="New chat"&&!projectRow)return null;
    const projectId=projectRow?.getAttribute("data-app-action-sidebar-project-id")||null;
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

  globalThis.GPTTweaksNewChat=Object.freeze({
    isEnabled:async method=>{
      if(method!=="slash")return false;
      if(!preferences)await refresh();
      return enabled("slash");
    },
    activate:method=>{if(method==="slash")open("slash");}
  });
})();
