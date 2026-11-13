/* Shared MAIN-world conversation history transport.
 * Only request metadata and headers are retained; response bodies are
 * returned to the requesting utility and never cached or broadcast here. */
(() => {
  "use strict";
  if(window.GPTTweaksConversationHistory)return;

  const nativeFetch=window.fetch.bind(window);
  const prefix="/backend-api/conversations/";
  const headersById=new Map();
  const pageObservers=new Set();
  const validId=id=>typeof id==="string"&&/^[a-f0-9-]{36}$/i.test(id);

  function identify(value) {
    try {
      const url=new URL(value,location.href);
      if(url.origin!==location.origin||!url.pathname.startsWith(prefix))return null;
      const id=url.pathname.slice(prefix.length);
      return validId(id)?{id,url}:null;
    }catch{return null;}
  }
  function captureHeaders(id,input,init) {
    if(!validId(id))return;
    try {
      const headers=new Headers(input instanceof Request?input.headers:undefined);
      if(init?.headers)new Headers(init.headers).forEach((value,key)=>headers.set(key,value));
      headersById.set(id,headers);
    }catch{ /* Unavailable original headers: use page-derived routing. */ }
  }
  function requestHeaders(id) {
    const headers=new Headers(headersById.get(id));
    if(!headers.has("accept"))headers.set("accept","application/json");
    if(!headers.has("chatgpt-account-id")){
      const account=document.documentElement.dataset.themeAccountId;
      if(account)headers.set("chatgpt-account-id",account);
    }
    if(!headers.has("x-openai-codex-window-type")){
      const type=document.documentElement.dataset.codexWindowType;
      if(type)headers.set("x-openai-codex-window-type",type);
    }
    if(!headers.has("x-openai-web-frontend")&&
       document.documentElement.dataset.codexWindowType==="browser")
      headers.set("x-openai-web-frontend","codex_webview");
    return headers;
  }
  function delay(ms,signal){
    return new Promise(resolve=>{
      if(signal?.aborted)return resolve();
      let timer;
      const abort=()=>{clearTimeout(timer);resolve();};
      timer=setTimeout(()=>{
        signal?.removeEventListener("abort",abort);
        resolve();
      },ms);
      signal?.addEventListener("abort",abort,{once:true});
    });
  }
  function permit(id){
    return new Promise((resolve,reject)=>{
      // Fail closed: a missing/disabled guard must never permit an API request.
      const requestId=crypto.randomUUID();
      const timeout=setTimeout(()=>{
        document.removeEventListener("gpt-tweaks:history:permission",receive);
        reject(Error("Extension history safety guard unavailable"));
      },7000);
      function receive(event){
        let response;
        try{response=JSON.parse(event.detail);}catch{return;}
        if(response?.id!==requestId)return;
        clearTimeout(timeout);
        document.removeEventListener("gpt-tweaks:history:permission",receive);
        if(response.ok&&typeof response.token==="string")resolve(response.token);
        else{
          const error=Error(response.error||"History requests are paused by the safety limit");
          if(Number.isFinite(response.retryAt))error.retryAt=response.retryAt;
          reject(error);
        }
      }
      document.addEventListener("gpt-tweaks:history:permission",receive);
      document.dispatchEvent(new CustomEvent("gpt-tweaks:history:permit",{
        detail:JSON.stringify({id:requestId,conversation:id})
      }));
    });
  }
  async function controlledPermit(id,signal){
    // A user-invoked multi-page copy may wait for the minimum 30-second gap,
    // but never loop through hourly limits or a 429 cooldown.
    for(let tries=0;tries<3;tries++){
      if(signal?.aborted)throw Error("History request canceled");
      try{return await permit(id);}
      catch(error){
        const remaining=Number(error.retryAt)-Date.now();
        if(!Number.isFinite(remaining)||remaining<=0||remaining>35000||tries===2)
          throw error;
        await delay(remaining+100,signal);
      }
    }
    throw Error("History request unavailable");
  }
  function settle(token,status){
    document.dispatchEvent(new CustomEvent("gpt-tweaks:history:settle",{
      detail:JSON.stringify({token,status})
    }));
  }
  async function fetchPage(id,{before=null,pageSize=10,signal}={}){
    if(!validId(id))throw Error("Invalid conversation ID");
    const url=new URL(prefix+encodeURIComponent(id),location.origin);
    url.searchParams.set("num_turns",pageSize===2?"2":"10");
    url.searchParams.set("include_has_versions","true");
    if(before)url.searchParams.set("before",before);
    const headers=requestHeaders(id);
    // Every extension-created request passes the shared cross-tab budget.
    // Never retry network/HTTP failures automatically.
    const token=await controlledPermit(id,signal);
    let status=0;
    try{
      if(signal?.aborted)throw Error("History request canceled");
      const response=await nativeFetch(url.href,{
        method:"GET",headers,credentials:"include",cache:"no-store",signal
      });
      status=response.status;
      if(!response.ok)throw Error("History request returned HTTP "+response.status);
      const page=await response.json();
      if(!Array.isArray(page?.messages)||!page.page_info||
         typeof page.page_info.has_previous_page!=="boolean")
        throw Error("Unsupported conversation history response");
      // Let metadata consumers reuse an explicitly requested history page.
      // Keep raw message contents inside the MAIN world and the caller.
      for(const subscriber of pageObservers){
        try{subscriber(id,before,page);}catch{}
      }
      return page;
    }finally{settle(token,status);}
  }

  // Fetch oldest pages as necessary even when only the latest turns exist in
  // ChatGPT's virtualized DOM. Caller owns the raw messages and their lifetime.
  async function scan(id,{signal,onPage,maxPages=2000}={}){
    let before=null;
    const cursors=new Set();
    for(let count=0;count<maxPages;count++){
      const page=await fetchPage(id,{before,signal});
      // Only callers that have already identified a complete requested range
      // may stop early. Existing consumers continue through pagination.
      if(await onPage?.(page,count)===false)return count+1;
      if(!page.page_info.has_previous_page)return count+1;
      const next=page.page_info.start_cursor;
      if(typeof next!=="string"||!next||cursors.has(next))
        throw Error("History pagination did not advance");
      cursors.add(next);
      before=next;
      await delay(700,signal);
    }
    throw Error("History exceeds the pagination limit");
  }
  window.GPTTweaksConversationHistory=Object.freeze({
    identify,captureHeaders,fetchPage,scan,
    observePage(listener){
      if(typeof listener!=="function")throw Error("Invalid page observer");
      pageObservers.add(listener);
      return ()=>pageObservers.delete(listener);
    }
  });
})();
