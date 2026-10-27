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
  function open(method) {
    if(!enabled(method))return;
    void chrome.runtime.sendMessage({type:"gpt-tweaks:new-chat:open",method})
      .then(result=>{
        if(!result?.ok)console.warn("[GPT Tweaks] Unable to open new chat:",result?.error);
      })
      .catch(error=>console.warn("[GPT Tweaks] Unable to open new chat:",error));
  }

  // ChatGPT currently renders the sidebar New chat controls as buttons.
  // Scope the delegated handler to the sidebar so toolbar/project controls
  // and the normal left-click interaction remain untouched.
  function sidebarNewChat(target) {
    if(!(target instanceof Element))return false;
    const button=target.closest('button[aria-label="New chat"],a[aria-label="New chat"]');
    return !!(button&&button.closest("#app-shell-sidebar,aside,nav[aria-label]"));
  }
  function onMiddleClick(event) {
    if(event.button!==1||!enabled("middle")||!sidebarNewChat(event.target))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(event.type==="auxclick")open("middle");
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
