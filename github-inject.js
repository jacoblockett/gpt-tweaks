(() => {
  "use strict";
  if (globalThis.__gptTweaksGitHubLoaded) return;
  globalThis.__gptTweaksGitHubLoaded = true;

  const COMMAND="/attach-github-source";
  const COMMAND_TITLE="Attach GitHub Source";
  // Match the feature description in website/index.html; do not modify settings copy.
  const ARCHIVE_DESCRIPTION="Attach a GitHub repository source code.";
  const REPO=/^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]{1,100}$/i;
  let modal=null, busy=false, verified="", branchPage=0,commitPage=0,tip="",repoGen=0,commitGen=0;
  let history=[],mine=[],installationsCount=0,signedIn=false,authReady=false,accountName="",accountStatusPromise=null,slashAllowed=false,slashFeatureEnabled=null;
  let observer=null,scanQueued=false,scanTimer=null,slashSuggestion=null,lookupTimer=null;
  const id=id=>modal?.querySelector("#"+id);
  const option=(label,value)=>{const e=document.createElement("option");e.textContent=label;e.value=value;return e;};
  const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  async function request(kind,fields={}) {
    const reply=await chrome.runtime.sendMessage({kind:"gpt-github-"+kind,...fields});
    if(!reply?.ok){
      const error=new Error(reply?.error||"GitHub operation failed.");
      error.code=reply?.code||"";
      throw error;
    }
    return reply.data;
  }
  function repoFrom(text) {
    let value=String(text||"").trim();
    if(REPO.test(value)&&!value.endsWith(".git"))return value;
    try {
      const url=new URL(value);
      if(url.protocol!=="https:"||url.hostname!=="github.com")return "";
      const path=url.pathname.split("/").filter(Boolean);
      if(path.length!==2)return "";
      value=path.join("/").replace(/\.git$/i,"");
      return REPO.test(value)?value:"";
    } catch {return "";}
  }
  function status(text,isError=false) {
    const node=id("gtg-status");
    if(!node)return;
    node.textContent=text;
    node.hidden=!text;
    node.dataset.error=isError?"true":"false";
  }
  function localComposer() {
    return document.querySelector('[data-composer-input] [contenteditable="true"][role="textbox"]') ||
      document.querySelector('[data-testid="composer-text-input"]') ||
      document.querySelector('#prompt-textarea') ||
      document.querySelector('[contenteditable="true"][role="textbox"]');
  }
  function editableText(el) {
    if(!el)return "";
    return (el.innerText||el.textContent||"").trim();
  }
  function visible(el){return Boolean(el?.isConnected&&el.getClientRects().length);}
  function isEnabled(method) {
    return request("feature-status",{method}).then(x=>x.enabled);
  }
  function clearUi() {
    if(modal){modal.remove();modal=null;}
    busy=false;clearTimeout(lookupTimer);
    repoGen++;commitGen++;
    accountStatusPromise=null;
  }
  const caret='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const searchIcon='<svg class="gtg-input-leading" aria-hidden="true" width="19" height="19" viewBox="0 0 20 20" fill="none"><circle cx="8.75" cy="8.75" r="6" stroke="currentColor" stroke-width="1.7"/><path d="m13.2 13.2 4.4 4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const checkIcon='<svg aria-hidden="true" width="19" height="19" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.3" stroke="currentColor" stroke-width="1.6"/><path d="m6.6 10 2.2 2.2 4.6-4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const miniIcons={
    history:'<svg class="gtg-entry-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3.2 8.3A7 7 0 1 1 3.8 13M3 3.8v4.7h4.7M10 5.8V10l2.7 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    repository:'<svg class="gtg-entry-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3"/><path d="M15 22v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 19 4.77 5.07 5.07 0 0 0 18.91 1S17.73.65 15 2.48a13.38 13.38 0 0 0-7 0C5.27.65 4.09 1 4.09 1A5.07 5.07 0 0 0 4 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 8 18.13V22"/></svg>',
    lock:'<svg class="gtg-entry-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="4.4" y="8.5" width="11.2" height="8.3" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 8.3V6a3 3 0 0 1 6 0v2.3M10 12v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
  };
  async function launch(method) {
    if(!(await isEnabled(method))||modal)return;
    resetSlash();
    signedIn=false;authReady=false;accountName="";history=[];mine=[];installationsCount=0;
    const dialog=document.createElement("dialog");
    modal=dialog;
    dialog.id="gtg-dialog";
    dialog.setAttribute("aria-labelledby","gtg-heading");
    dialog.innerHTML=[
      '<div class="gtg-header"><h2 id="gtg-heading">Attach GitHub Source</h2><button type="button" class="gtg-icon" id="gtg-close" aria-label="Close"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5 15 15M15 5 5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>',
      '<div class="gtg-body">',
      '<label class="gtg-label" for="gtg-repo">Repository</label>',
      '<div class="gtg-repo-control"><div class="gtg-input-wrap">',searchIcon,'<input id="gtg-repo" type="text" autocomplete="off" spellcheck="false" placeholder="Search repositories or paste a GitHub URL" aria-controls="gtg-options" aria-expanded="false" />',
      '<span class="gtg-verified" id="gtg-verified" hidden>',checkIcon,'</span>',
      '<span class="gtg-lookup-progress" id="gtg-lookup-progress" role="status" aria-label="Loading" hidden><span class="gtg-spinner" aria-hidden="true"></span></span>',
      '<button id="gtg-toggle" class="gtg-icon" type="button" aria-label="Show repositories" aria-expanded="false">',caret,'</button></div>',
      '<div id="gtg-options" class="gtg-options" hidden></div></div>',
      '<div id="gtg-revisions" class="gtg-revisions" hidden>',
      '<div><label class="gtg-label" for="gtg-branch-trigger">Branch</label><div class="gtg-select-wrap"><select id="gtg-branch" hidden></select><button type="button" class="gtg-select-trigger" id="gtg-branch-trigger" aria-expanded="false" aria-haspopup="listbox" aria-controls="gtg-branch-list"><span id="gtg-branch-label"></span>',caret,'</button><div class="gtg-revision-list" id="gtg-branch-list" role="listbox" aria-label="Branches" hidden></div></div><button type="button" id="gtg-more-branches" class="gtg-more" hidden>Load more branches</button></div>',
      '<div><label class="gtg-label" for="gtg-commit-trigger">Commit</label><div class="gtg-select-wrap"><select id="gtg-commit" hidden></select><button type="button" class="gtg-select-trigger" id="gtg-commit-trigger" aria-expanded="false" aria-haspopup="listbox" aria-controls="gtg-commit-list"><span id="gtg-commit-label"></span>',caret,'</button><div class="gtg-revision-list" id="gtg-commit-list" role="listbox" aria-label="Commits" hidden></div></div><button type="button" id="gtg-more-commits" class="gtg-more" hidden>Load older commits</button></div>',
      '</div>',
      '<div class="gtg-auth" id="gtg-auth" hidden><p id="gtg-auth-prompt"></p><button type="button" class="gtg-aux" id="gtg-login">Sign in with GitHub</button>',
      '<div id="gtg-device" class="gtg-device-panel" hidden><span class="gtg-device-label">Enter this code in the GitHub tab</span><strong id="gtg-device-code" class="gtg-device-code"></strong></div></div>',
      '<div id="gtg-status" class="gtg-status" role="status" aria-live="polite" hidden></div>',
      '</div><div class="gtg-footer"><button type="button" class="gtg-btn gtg-cancel" id="gtg-cancel">Cancel</button>',
      '<button type="button" class="gtg-btn gtg-attach" id="gtg-attach" disabled><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.67 3.67 0 0 1 5.19 5.19l-8.49 8.49a1.83 1.83 0 0 1-2.6-2.59l7.78-7.78"/></svg><span>Attach</span></button></div>'
    ].join("");
    document.body.append(dialog);
    dialog.addEventListener("close",clearUi,{once:true});
    dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
    dialog.addEventListener("click",event=>{
      if(busy||event.target!==dialog)return;
      const r=dialog.getBoundingClientRect();
      if(event.clientX<r.left||event.clientX>r.right||
         event.clientY<r.top||event.clientY>r.bottom)dialog.close();
    });
    id("gtg-close").addEventListener("click",()=>dialog.close());
    id("gtg-cancel").addEventListener("click",()=>dialog.close());
    id("gtg-toggle").addEventListener("click",()=>{
      if(id("gtg-options").hidden)showSuggestions();
      else hideSuggestions();
    });
    id("gtg-repo").addEventListener("input",()=>{
      clearTimeout(lookupTimer);
      resetRepo();showSuggestions();
      const name=repoFrom(id("gtg-repo").value);
      if(name){
        id("gtg-lookup-progress").hidden=false;
        lookupTimer=setTimeout(()=>choose(name),850);
      }
    });
    id("gtg-repo").addEventListener("keydown",event=>{
      if(event.key==="Enter"){
        const name=repoFrom(event.currentTarget.value);
        if(name){event.preventDefault();choose(name);}
      }else if(event.key==="Escape"&&!id("gtg-options").hidden){
        event.stopPropagation();hideSuggestions();
      }
    });
    id("gtg-branch").addEventListener("change",()=>loadCommits(1,repoGen));
    for(const kind of ["branch","commit"]){
      const trigger=id("gtg-"+kind+"-trigger");
      trigger.addEventListener("click",()=>toggleRevisionMenu(kind));
      trigger.addEventListener("keydown",event=>{
        if(["ArrowDown","ArrowUp"].includes(event.key)){
          event.preventDefault();showRevisionMenu(kind);
        }
      });
    }
    dialog.addEventListener("pointerdown",event=>{
      if(!event.target.closest(".gtg-repo-control"))hideSuggestions();
      if(!event.target.closest(".gtg-select-wrap"))hideRevisionMenus();
    },true);
    id("gtg-more-branches").addEventListener("click",()=>loadBranches(branchPage+1,repoGen).catch(err=>status(err.message,true)));
    id("gtg-more-commits").addEventListener("click",()=>loadCommits(commitPage+1,repoGen));
    id("gtg-login").addEventListener("click",startLogin);
    id("gtg-attach").addEventListener("click",attach);
    dialog.showModal();
    id("gtg-repo").focus();
    accountStatusPromise=request("auth-status").then(account=>{
      if(modal!==dialog)return;
      signedIn=!!account.connected;authReady=true;accountName=account.account||"";
    }).catch(()=>{if(modal===dialog)authReady=false;});
    const recentPromise=request("history").then(recent=>{
      if(modal!==dialog)return;
      history=recent;renderSuggestions();
    }).catch(err=>{if(modal===dialog)status(err.message,true);});
    await Promise.all([accountStatusPromise,recentPromise]);
    if(modal!==dialog||!signedIn)return;
    try{
      const result=await request("repositories");
      mine=result.repositories||[];
      installationsCount=result.installationsCount||0;
      if(modal===dialog)renderSuggestions();
    }catch(err){if(modal===dialog)status(err.message,true);}
  }
  function hideRevisionMenus(){
    for(const kind of ["branch","commit"]){
      const panel=id("gtg-"+kind+"-list"),trigger=id("gtg-"+kind+"-trigger");
      if(panel)panel.hidden=true;
      trigger?.setAttribute("aria-expanded","false");
    }
  }
  function syncRevisionTriggers(){
    for(const kind of ["branch","commit"]){
      const select=id("gtg-"+kind),trigger=id("gtg-"+kind+"-trigger");
      if(!select||!trigger)continue;
      const label=id("gtg-"+kind+"-label");
      label.textContent=kind==="commit"&&!select.value?"Latest":
        select.selectedOptions?.[0]?.textContent||"Select "+kind;
      trigger.disabled=select.disabled||!select.options.length;
    }
  }
  function showRevisionMenu(kind){
    const select=id("gtg-"+kind),trigger=id("gtg-"+kind+"-trigger"),panel=id("gtg-"+kind+"-list");
    if(!select||select.disabled||!select.options.length)return;
    hideSuggestions();hideRevisionMenus();
    panel.replaceChildren();
    for(const choice of select.options){
      const row=document.createElement("button");
      row.type="button";row.className="gtg-revision-option";
      row.setAttribute("role","option");
      row.setAttribute("aria-selected",String(choice.value===select.value));
      row.textContent=choice.textContent;row.title=choice.textContent;
      row.addEventListener("click",()=>{
        const changed=select.value!==choice.value;
        select.value=choice.value;
        hideRevisionMenus();syncRevisionTriggers();
        if(changed)select.dispatchEvent(new Event("change",{bubbles:true}));
        trigger.focus();
      });
      panel.append(row);
    }
    panel.hidden=false;trigger.setAttribute("aria-expanded","true");
    const rows=[...panel.querySelectorAll(".gtg-revision-option")];
    (rows.find(x=>x.getAttribute("aria-selected")==="true")||rows[0])?.focus();
    panel.onkeydown=event=>{
      if(event.key==="Escape"){
        event.preventDefault();hideRevisionMenus();trigger.focus();return;
      }
      if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
      event.preventDefault();
      const index=rows.indexOf(document.activeElement);
      const next=event.key==="Home"?0:event.key==="End"?rows.length-1:
        (index+(event.key==="ArrowDown"?1:-1)+rows.length)%rows.length;
      rows[next]?.focus();
    };
  }
  function toggleRevisionMenu(kind){
    if(id("gtg-"+kind+"-list").hidden)showRevisionMenu(kind);
    else hideRevisionMenus();
  }
  function hideSuggestions(){
    const box=id("gtg-options");if(!box)return;
    box.hidden=true;
    id("gtg-repo").setAttribute("aria-expanded","false");
    id("gtg-toggle").setAttribute("aria-expanded","false");
  }
  function showSuggestions(){
    const box=id("gtg-options");if(!box)return;
    hideRevisionMenus();
    box.hidden=false;
    renderSuggestions();
  }
  function renderSuggestions(){
    const box=id("gtg-options");if(!box)return;
    const wasOpen=!box.hidden;
    box.replaceChildren();
    const query=id("gtg-repo").value.trim().toLowerCase();
    const recent=history.filter(x=>x.toLowerCase().includes(query));
    const recentNames=new Set(recent.map(x=>x.toLowerCase()));
    const own=mine.filter(x=>x.repo.toLowerCase().includes(query)&&!recentNames.has(x.repo.toLowerCase()));
    function group(title,items,isRecent){
      if(!items.length)return;
      if(box.childNodes.length){
        const line=document.createElement("div");line.className="gtg-options-divider";box.append(line);
      }
      const head=document.createElement("div");head.className="gtg-group";
      const label=document.createElement("span");label.textContent=title;head.append(label);
      if(isRecent){
        const clear=document.createElement("button");clear.type="button";clear.textContent="Clear history";
        clear.addEventListener("click",async()=>{
          try{history=await request("history-clear");renderSuggestions();}
          catch(err){status(err.message,true);}
        });
        head.append(clear);
      }else if(accountName){
        const account=document.createElement("span");account.className="gtg-account";
        account.textContent=accountName;head.append(account);
      }
      box.append(head);
      for(const item of items){
        const name=typeof item==="string"?item:item.repo;
        const line=document.createElement("div");line.className="gtg-option-row";
        const pick=document.createElement("button");
        pick.type="button";pick.className="gtg-pick";
        pick.innerHTML=miniIcons[isRecent?"history":item.private?"lock":"repository"];
        const nameEl=document.createElement("span");
        nameEl.className="gtg-pick-text";nameEl.textContent=name;pick.append(nameEl);
        pick.addEventListener("click",()=>choose(name));
        line.append(pick);
        if(!isRecent&&item.private){
          const flag=document.createElement("span");flag.className="gtg-private";
          flag.textContent="Private";line.append(flag);
        }
        if(isRecent){
          const remove=document.createElement("button");
          remove.type="button";remove.className="gtg-remove";
          remove.setAttribute("aria-label","Remove "+name+" from history");
          remove.textContent="×";
          remove.addEventListener("click",async()=>{
            try{history=await request("history-remove",{repo:name});renderSuggestions();}
            catch(err){status(err.message,true);}
          });
          line.append(remove);
        }
        box.append(line);
      }
    }
    group("Recently attached",recent,true);
    group("Your repositories",own,false);
    if(signedIn&&!installationsCount){
      const note=document.createElement("p");
      note.className="gtg-install-note";
      note.textContent="No GitHub App installation found. Install GPT Tweaks on GitHub and grant repository access to list private repositories.";
      box.append(note);
    }
    // An empty suggestion list is not an input placeholder or a visible panel.
    box.hidden=!box.childNodes.length||!wasOpen;
    const expanded=!box.hidden;
    id("gtg-repo").setAttribute("aria-expanded",String(expanded));
    id("gtg-toggle").setAttribute("aria-expanded",String(expanded));
  }
  function showLoading(){
    if(!modal)return;
    hideRevisionMenus();
    id("gtg-revisions").hidden=true;
    id("gtg-verified").hidden=true;
    id("gtg-lookup-progress").hidden=false;
    id("gtg-attach").disabled=true;
    status("");
  }
  function hideLoading(){
    if(id("gtg-lookup-progress"))id("gtg-lookup-progress").hidden=true;
  }
  function resetRepo(){
    hideRevisionMenus();
    repoGen++;commitGen++;verified="";branchPage=0;commitPage=0;tip="";
    hideLoading();
    id("gtg-revisions").hidden=true;
    id("gtg-verified").hidden=true;
    id("gtg-attach").disabled=true;
    id("gtg-auth").hidden=true;
    status("");
  }
  function prepareRevisionLoading(){
    id("gtg-more-branches").hidden=true;
    id("gtg-more-commits").hidden=true;
    showLoading();
  }
  async function choose(name){
    if(!modal||!repoFrom(name))return;
    clearTimeout(lookupTimer);resetRepo();
    const gen=repoGen,dialog=modal;
    id("gtg-repo").value=name;
    hideSuggestions();
    prepareRevisionLoading();
    try{
      await loadBranches(1,gen);
    }catch(err){
      if(gen!==repoGen||modal!==dialog)return;
      hideLoading();
      id("gtg-revisions").hidden=true;
      id("gtg-verified").hidden=true;
      if(err.code==="REPOSITORY_UNAVAILABLE"){
        if(accountStatusPromise)await accountStatusPromise;
        if(gen!==repoGen||modal!==dialog)return;
        if(authReady&&!signedIn){
          id("gtg-auth-prompt").textContent="This repository couldn't be found. If it's private, sign in with GitHub to check your access.";
          id("gtg-auth").hidden=false;
          status("");
          return;
        }
      }
      status(err.message,true);
    }
  }
  async function loadBranches(page,generation=repoGen){
    const repo=repoFrom(id("gtg-repo")?.value);
    if(!repo)return;
    if(page>1)showLoading();
    try{
      const data=await request("branches",{repo,page});
      if(generation!==repoGen||!modal)return;
      if(page===1){
        verified=data.repo;
        const branch=id("gtg-branch");
        branch.replaceChildren();
        if(data.defaultBranch)branch.append(option(data.defaultBranch,data.defaultBranch));
      }
      const branch=id("gtg-branch");
      const existing=new Set([...branch.options].map(x=>x.value));
      for(const name of data.branches){
        if(!existing.has(name)){branch.append(option(name,name));existing.add(name);}
      }
      branchPage=page;
      branch.disabled=false;
      syncRevisionTriggers();
      id("gtg-more-branches").hidden=!data.hasMore;
      if(page===1){
        if(!branch.value)throw Error("Repository has no branches.");
        await loadCommits(1,generation);
      }else{
        hideLoading();
        id("gtg-revisions").hidden=false;
        id("gtg-attach").disabled=false;
      }
    }catch(err){
      if(generation===repoGen&&modal){
        hideLoading();
        if(page>1){id("gtg-revisions").hidden=false;id("gtg-attach").disabled=false;}
      }
      throw err;
    }
  }
  async function loadCommits(page,generation=repoGen){
    const branch=id("gtg-branch")?.value,repo=verified;
    if(!repo||!branch)return;
    const commitRequest=++commitGen;
    showLoading();
    try{
      const data=await request("commits",{repo,branch,page,...(page>1?{tip}:{})});
      if(generation!==repoGen||commitRequest!==commitGen||!modal||id("gtg-branch").value!==branch)return;
      const commit=id("gtg-commit");
      if(page===1){
        tip=data.tip;
        commit.replaceChildren(option("Latest",""));
      }
      const existing=new Set([...commit.options].map(x=>x.value));
      for(const entry of data.commits){
        if(!existing.has(entry.sha)){
          commit.append(option(entry.sha.slice(0,10)+" · "+entry.date+" · "+entry.message,entry.sha));
          existing.add(entry.sha);
        }
      }
      commitPage=page;
      commit.disabled=false;
      syncRevisionTriggers();
      id("gtg-more-commits").hidden=!data.hasMore;
      id("gtg-verified").hidden=false;
      hideLoading();
      id("gtg-revisions").hidden=false;
      id("gtg-attach").disabled=false;
    }catch(err){
      if(generation===repoGen&&commitRequest===commitGen&&modal){
        hideLoading();
        if(page>1){id("gtg-revisions").hidden=false;id("gtg-attach").disabled=false;}
        status(err.message,true);
      }
    }
  }
  async function startLogin(){
    id("gtg-login").disabled=true;
    try{
      const data=await request("auth-start");
      if(!modal)return;
      id("gtg-auth-prompt").hidden=true;
      id("gtg-login").hidden=true;
      id("gtg-device").hidden=false;
      id("gtg-device-code").textContent=data.user_code;
      status("");
      await request("auth-open");
      const expiry=Date.now()+data.expires_in*1000;
      let interval=data.interval*1000;
      while(modal&&Date.now()<expiry){
        await new Promise(resolve=>setTimeout(resolve,interval));
        if(!modal)return;
        const result=await request("auth-poll");
        if(result.connected){
          signedIn=true;authReady=true;accountName=result.account||"";
          id("gtg-auth").hidden=true;
          const result=await request("repositories");
          mine=result.repositories||[];
          installationsCount=result.installationsCount||0;
          status("");
          renderSuggestions();
          const repo=repoFrom(id("gtg-repo").value);
          if(repo)await choose(repo);
          return;
        }
        interval=Math.max(result.interval*1000,interval);
      }
      throw Error("GitHub verification expired. Try again.");
    }catch(err){if(modal)status(err.message,true);}
    finally{if(modal)id("gtg-login").disabled=false;}
  }
  function base64Bytes(encoded){
    const raw=atob(encoded),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return bytes;
  }
  function acceptsZip(input){
    if(input.disabled||input.webkitdirectory)return false;
    const accept=(input.getAttribute("accept")||"").trim().toLowerCase();
    if(!accept||accept==="*/*")return true;
    return accept.split(",").map(x=>x.trim()).some(x=>
      [".zip","application/zip","application/x-zip-compressed","application/octet-stream"].includes(x));
  }
  function uploadFile(file){
    const target=localComposer();
    const form=target?.closest("form");
    const inputs=[...document.querySelectorAll('input[type="file"]')].filter(acceptsZip);
    // Prefer the active composer over unrelated file controls elsewhere in ChatGPT.
    inputs.sort((a,b)=>Number(Boolean(form?.contains(b)))-Number(Boolean(form?.contains(a))));
    for(const input of inputs){
      try{
        const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;
        input.dispatchEvent(new Event("input",{bubbles:true,composed:true}));
        input.dispatchEvent(new Event("change",{bubbles:true,composed:true}));
        return true;
      }catch{}
    }
    if(!target)return false;
    try{
      const dt=new DataTransfer();dt.items.add(file);
      for(const type of ["dragenter","dragover","drop"])
        target.dispatchEvent(new DragEvent(type,{bubbles:true,composed:true,cancelable:true,dataTransfer:dt}));
      return true;
    }catch{return false;}
  }
  function composerAttachmentState(composer,filename){
    const form=composer?.closest("form");
    const root=form?.querySelector("[data-composer-attachments]") ||
      document.querySelector("[data-composer-attachments]");
    if(!root)return {root:null,count:0,named:false};
    const text=root.textContent||"";
    const named=text.includes(filename) || root.querySelectorAll("[title],[aria-label],[alt]").length>0 &&
      [...root.querySelectorAll("[title],[aria-label],[alt]")].some(el=>
        ["title","aria-label","alt"].some(attr=>(el.getAttribute(attr)||"").includes(filename)));
    return {root,count:root.children.length,named};
  }
  async function attach(){
    if(busy||!verified)return;
    busy=true;let handedOff=false;
    id("gtg-attach").disabled=true;id("gtg-cancel").disabled=true;id("gtg-close").disabled=true;
    try{
      showLoading();
      const data=await request("zip",{repo:verified,branch:id("gtg-branch").value,
        commit:id("gtg-commit").value});
      const file=new File([base64Bytes(data.base64)],data.filename,{type:"application/zip"});
      const composer=localComposer();
      const before=composerAttachmentState(composer,file.name);
      if(!uploadFile(file))throw Error("ChatGPT file uploader could not be found.");
      handedOff=true;
      let shown=false;
      for(let i=0;i<60;i++){
        await new Promise(resolve=>setTimeout(resolve,250));
        const after=composerAttachmentState(composer,file.name);
        if(after.root&&!after.root.hidden&&!before.named &&
          (after.named||after.count>before.count)){shown=true;break;}
      }
      if(!shown)throw Error("Attachment handoff was attempted, but no new composer attachment was confirmed. Check the composer before retrying.");
      try{history=await request("history-add",{repo:verified});}
      catch(err){status("Attachment displayed, but history could not be saved: "+err.message,true);return;}
      modal?.close();
    }catch(err){
      hideLoading();
      if(modal&&verified)id("gtg-revisions").hidden=false;
      status(err.message,true);
    }
    finally{
      busy=false;
      if(id("gtg-cancel"))id("gtg-cancel").disabled=false;
      if(id("gtg-close"))id("gtg-close").disabled=false;
      if(modal&&id("gtg-loading")&&!id("gtg-loading").hidden)hideLoading();
      // An unconfirmed handoff may still be uploading. Do not allow an accidental duplicate.
      if(id("gtg-attach"))id("gtg-attach").disabled=!verified||handedOff;
    }
  }

  // GitHub's outline mark matches the visual weight of ChatGPT's native menu icons.
  // Explicit 16/20 px variants retain the site's compact/expanded icon behavior.
  function githubIcon(size){
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("width",String(size));
    svg.setAttribute("height",String(size));
    svg.setAttribute("viewBox","0 0 24 24");
    svg.setAttribute("fill","none");
    svg.setAttribute("stroke","currentColor");
    svg.setAttribute("stroke-width","1.8");
    svg.setAttribute("stroke-linecap","round");
    svg.setAttribute("stroke-linejoin","round");
    svg.setAttribute("aria-hidden","true");
    const shapes=[
      "M9 19c-4.3 1.4-4.3-2.5-6-3",
      "M15 22v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 19 4.77 5.07 5.07 0 0 0 18.91 1S17.73.65 15 2.48a13.38 13.38 0 0 0-7 0C5.27.65 4.09 1 4.09 1A5.07 5.07 0 0 0 4 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 8 18.13V22"
    ];
    for(const d of shapes){
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",d);
      svg.append(path);
    }
    return svg;
  }
  function setGitHubIcon(iconSlot){
    iconSlot.replaceChildren();
    for(const [size,klass] of [[16,"CompactSource-d7ZD01"],[20,"LeadingSource-d79mNZ"]]){
      const span=document.createElement("span");
      span.className=klass;
      span.setAttribute("aria-hidden","true");
      span.append(githubIcon(size));
      iconSlot.append(span);
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
    if(section.querySelector('[data-gtg-menu-option="true"]'))return;

    // Clone the native row's entire layout, not just its outer button.
    // The captured ChatGPT menu uses these semantic data attributes for
    // the icon, label, description and menu-section parent.
    const button=element.cloneNode(true);
    for(const attr of ["id","aria-current","aria-selected","aria-haspopup","aria-expanded","data-state"])
      button.removeAttribute(attr);
    button.dataset.gtgMenuOption="true";
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

    setGitHubIcon(iconSlot);
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
      const existing=native.parentElement.querySelector('[data-gtg-menu-option="true"]');
      if(enabled)createMenuOption(native);
      else {
        existing?.remove();
        removeMenuGroup("menu");
      }
    }catch{}
  }
  function resetSlash(){
    slashAllowed=false;
    if(slashSuggestion){
      if(virtualRow===slashSuggestion)clearVirtualRow();
      slashSuggestion.remove();slashSuggestion=null;
    }
    document.getElementById("gtg-command-fallback")?.remove();
    removeMenuGroup("slash");
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
    row.className="gtg-fallback-row";
    const icon=document.createElement("span");
    icon.className="gtg-fallback-icon";
    icon.append(githubIcon(20));
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
      if(icon)setGitHubIcon(icon);
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
  let virtualRow=null;
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
  function nativeNeighbor(row,direction){
    let node=row;
    for(;;){
      node=direction<0?node.previousElementSibling:node.nextElementSibling;
      if(!node)return null;
      if(node.matches('button[data-list-navigation-item="true"]'))return node;
    }
  }
  function interceptMenuKey(event){
    if(modal||event.isComposing||event.altKey||event.metaKey||event.ctrlKey)return;
    const active=[...document.querySelectorAll('[data-gtg-menu-option="true"],#gtg-slash')]
      .filter(row=>visible(row));
    if(active.length!==1){clearVirtualRow();return;}
    const row=active[0];
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
        if(!nativeRows.length){
          event.preventDefault();event.stopImmediatePropagation();
          return;
        }
        const direction=event.key==="ArrowDown"?1:-1;
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
  // Registered before the dynamically opened menu installs its window handler.
  window.addEventListener("keydown",interceptMenuKey,true);
  document.addEventListener("mousemove",event=>{
    if(!virtualRow)return;
    const hovered=event.target instanceof Element?
      event.target.closest('button[data-list-navigation-item="true"]'):null;
    if(hovered)clearVirtualRow();
  },true);
  window.addEventListener("keydown",event=>{
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
  },true);
  document.addEventListener("input",event=>{
    const composer=localComposer();
    if(composer&&(composer===event.target||composer.contains(event.target)))updateSlash();
  },true);
  // Native command filtering runs after keystrokes; recheck after its menu
  // closes so the extension-owned match remains available for long queries.
  document.addEventListener("keyup",event=>{
    const composer=localComposer();
    if(composer&&(composer===event.target||composer.contains(event.target)))updateSlash();
  },true);
  function scan(){
    scanQueued=false;scanMenu();
    if(slashSuggestion&&!slashSuggestion.isConnected)slashSuggestion=null;
    updateSlash();
  }
  function scheduleScan(){
    if(!scanQueued){scanQueued=true;scanTimer=setTimeout(scan,100);}
  }
  observer=new MutationObserver(scheduleScan);
  const observeDocument=()=>{
    if(document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true});
    scheduleScan();
  };
  if(document.documentElement)observeDocument();
  else document.addEventListener("DOMContentLoaded",observeDocument,{once:true});
})();