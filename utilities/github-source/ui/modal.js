(() => {
  "use strict";
  if (globalThis.__gptTweaksGitHubLoaded) return;
  globalThis.__gptTweaksGitHubLoaded = true;

  const REPO=/^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]{1,100}$/i;
  let modal=null,verified="",repoGen=0;
  let history=[],mine=[],repositoriesLoading=false,repositoriesFailed=false;
  let activeRepoName="",activeRepoQuery="";
  let lookupTimer=null;
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
  // Reuse slash-command semantics: match characters in order, not by substring.
  // Separators are ignored for matching without changing the user's input.
  function repositoryMatchPositions(name,query) {
    const letters=String(query||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const title=String(name||"").toLowerCase();
    const positions=[];
    let cursor=0;
    for(const char of letters){
      const next=title.indexOf(char,cursor);
      if(next<0)return null;
      positions.push(next);
      cursor=next+1;
    }
    return positions;
  }
  function repositoryMatches(name,query) {
    return repositoryMatchPositions(name,query)!==null;
  }
  function displayRepositoryMatch(label,name,query) {
    const positions=repositoryMatchPositions(name,query);
    if(!positions?.length){label.textContent=name;return;}
    label.dataset.gtgFuzzyActive="true";
    const active=new Set(positions);
    const letters=[];
    for(let i=0;i<name.length;i++){
      const span=document.createElement("span");
      if(active.has(i))span.className="gtg-fuzzy-match";
      span.textContent=name[i];
      letters.push(span);
    }
    label.replaceChildren(...letters);
  }
  function status(text,isError=false) {
    const node=id("gtg-status");
    if(!node)return;
    node.textContent=text;
    node.hidden=!text;
    node.dataset.error=isError?"true":"false";
  }
  const localComposer=()=>globalThis.__gptTweaksMenus.composer();
  function isEnabled(method) {
    return request("feature-status",{method}).then(x=>x.enabled);
  }
  function clearUi() {
    if(modal){modal.remove();modal=null;}
    attachment.reset();clearTimeout(lookupTimer);
    repoGen++;revisions.cancel();
  }
  const caret='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const searchIcon='<svg class="gtg-input-leading" aria-hidden="true" width="19" height="19" viewBox="0 0 20 20" fill="none"><circle cx="8.75" cy="8.75" r="6" stroke="currentColor" stroke-width="1.7"/><path d="m13.2 13.2 4.4 4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const checkIcon='<svg aria-hidden="true" width="19" height="19" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.3" stroke="currentColor" stroke-width="1.6"/><path d="m6.6 10 2.2 2.2 4.6-4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const miniIcons={
    history:'<svg class="gtg-entry-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3.2 8.3A7 7 0 1 1 3.8 13M3 3.8v4.7h4.7M10 5.8V10l2.7 1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    repository:'<svg class="gtg-entry-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3"/><path d="M15 22v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 19 4.77 5.07 5.07 0 0 0 18.91 1S17.73.65 15 2.48a13.38 13.38 0 0 0-7 0C5.27.65 4.09 1 4.09 1A5.07 5.07 0 0 0 4 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 8 18.13V22"/></svg>',
    lock:'<svg class="gtg-entry-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="4.4" y="8.5" width="11.2" height="8.3" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 8.3V6a3 3 0 0 1 6 0v2.3M10 12v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
  };
  const revisions=globalThis.__gptTweaksCreateRevisions({
    id,option,request,repoFrom,status,showLoading,hideLoading,hideSuggestions,
    getRepoGen:()=>repoGen,getModal:()=>modal,getVerified:()=>verified,
    setVerified:value=>{verified=value;}
  });
  const {hideRevisionMenus,showRevisionMenu,toggleRevisionMenu,renderCommitWindow,
    loadBranches,loadCommits,syncRevisionTriggers}=revisions;
  const attachment=globalThis.__gptTweaksCreateAttachment({
    id,request,showLoading,hideLoading,status,localComposer,
    getModal:()=>modal,getVerified:()=>verified,
    setHistory:value=>{history=value;}
  });
  async function launch(method) {
    if(!(await isEnabled(method))||modal)return;
    globalThis.__gptTweaksMenus.resetSlash();
    history=[];mine=[];repositoriesLoading=true;repositoriesFailed=false;
    activeRepoName="";activeRepoQuery="";
    const dialog=document.createElement("dialog");
    modal=dialog;
    dialog.id="gtg-dialog";
    dialog.setAttribute("aria-labelledby","gtg-heading");
    dialog.innerHTML=[
      '<div class="gtg-header"><h2 id="gtg-heading">Attach GitHub Source</h2><button type="button" class="gtg-icon" id="gtg-close" aria-label="Close"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5 15 15M15 5 5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>',
      '<div class="gtg-body">',
      '<label class="gtg-label" for="gtg-repo">Repository</label>',
      '<div class="gtg-repo-control"><div class="gtg-input-wrap">',searchIcon,'<input id="gtg-repo" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" autocomplete="off" spellcheck="false" placeholder="Search repositories or paste a GitHub URL" aria-controls="gtg-options" aria-expanded="false" />',
      '<span class="gtg-verified" id="gtg-verified" hidden>',checkIcon,'</span>',
      '<span class="gtg-lookup-progress" id="gtg-lookup-progress" role="status" aria-label="Loading" hidden><span class="gtg-spinner" aria-hidden="true"></span></span>',
      '<button id="gtg-toggle" class="gtg-icon" type="button" aria-label="Show repositories" aria-expanded="false">',caret,'</button></div>',
      '<div id="gtg-options" class="gtg-options" role="listbox" aria-label="Repositories" hidden></div></div>',
      '<div id="gtg-revisions" class="gtg-revisions" hidden>',
      '<div><label class="gtg-label" for="gtg-branch-trigger">Branch</label><div class="gtg-select-wrap"><select id="gtg-branch" hidden></select><button type="button" class="gtg-select-trigger" id="gtg-branch-trigger" aria-expanded="false" aria-haspopup="listbox" aria-controls="gtg-branch-list"><span id="gtg-branch-label"></span>',caret,'</button><div class="gtg-revision-list" id="gtg-branch-list" role="listbox" aria-label="Branches" hidden></div></div><button type="button" id="gtg-more-branches" class="gtg-more" hidden>Load more branches</button></div>',
      '<div><label class="gtg-label" for="gtg-commit-trigger">Commit</label><div class="gtg-select-wrap"><select id="gtg-commit" hidden></select><button type="button" class="gtg-select-trigger" id="gtg-commit-trigger" aria-expanded="false" aria-haspopup="listbox" aria-controls="gtg-commit-list"><span id="gtg-commit-label"></span>',caret,'</button><div class="gtg-revision-list" id="gtg-commit-list" role="listbox" aria-label="Commits" hidden></div></div></div>',
      '</div>',
      '<div id="gtg-status" class="gtg-status" role="status" aria-live="polite" hidden></div>',
      '</div><div class="gtg-footer"><button type="button" class="gtg-btn gtg-cancel" id="gtg-cancel">Cancel</button>',
      '<button type="button" class="gtg-btn gtg-attach" id="gtg-attach" disabled><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.67 3.67 0 0 1 5.19 5.19l-8.49 8.49a1.83 1.83 0 0 1-2.6-2.59l7.78-7.78"/></svg><span>Attach</span></button></div>'
    ].join("");
    document.body.append(dialog);
    dialog.addEventListener("close",clearUi,{once:true});
    dialog.addEventListener("cancel",event=>{if(attachment.isBusy())event.preventDefault();});
    dialog.addEventListener("click",event=>{
      if(attachment.isBusy()||event.target!==dialog)return;
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
      const entered=id("gtg-repo").value;
      const normalized=repoFrom(entered);
      // Preserve automatic lookup for complete/exact repositories and unknown
      // names, but don't interrupt choosing a different fuzzy suggestion.
      if(normalized&&(!activeRepoName||
          activeRepoName.toLowerCase()===normalized.toLowerCase())){
        id("gtg-lookup-progress").hidden=false;
        lookupTimer=setTimeout(()=>{
          if(modal!==dialog||id("gtg-repo").value!==entered)return;
          // The accessible inventory can arrive after typing starts.
          // Let an active fuzzy choice win over an old lookup timer.
          if(!id("gtg-options").hidden&&activeRepoName&&
              activeRepoName.toLowerCase()!==normalized.toLowerCase()){
            id("gtg-lookup-progress").hidden=true;
            return;
          }
          void choose(entered);
        },850);
      }
    });
    id("gtg-repo").addEventListener("keydown",event=>{
      if(event.isComposing)return;
      if(event.key==="ArrowDown"||event.key==="ArrowUp"){
        const wasHidden=id("gtg-options").hidden;
        if(wasHidden)showSuggestions();
        const picks=repositoryOptions();
        if(!picks.length)return;
        event.preventDefault();
        const current=picks.findIndex(pick=>pick.dataset.repoName===activeRepoName);
        const direction=event.key==="ArrowDown"?1:-1;
        const next=wasHidden||current<0 ?
          (direction===1?0:picks.length-1):
          (current+direction+picks.length)%picks.length;
        setActiveRepository(picks[next].dataset.repoName,true);
        clearTimeout(lookupTimer);
        id("gtg-lookup-progress").hidden=true;
      }else if(event.key==="Enter"){
        const active=!id("gtg-options").hidden?
          repositoryOptions().find(pick=>pick.dataset.repoName===activeRepoName):null;
        if(active){
          event.preventDefault();
          // Same operation as clicking the option, without blurring the field.
          active.click();
        }else{
          const entered=event.currentTarget.value;
          if(entered.trim()){event.preventDefault();void choose(entered);}
        }
      }else if(event.key==="Escape"&&!id("gtg-options").hidden){
        event.stopPropagation();hideSuggestions();
      }
    });
    id("gtg-branch").addEventListener("change",()=>loadCommits(1,repoGen).catch(()=>{if(modal)status("Could not load commits.",true);}));
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
    id("gtg-more-branches").addEventListener("click",()=>loadBranches(revisions.getBranchPage()+1,repoGen).catch(()=>{if(modal)status("Could not load branches.",true);}));
    id("gtg-attach").addEventListener("click",attachment.attach);
    dialog.showModal();
    globalThis.__gptTweaksDropdownScrollbars(dialog);
    id("gtg-repo").focus();
    const recentPromise=request("history").then(recent=>{
      if(modal!==dialog)return;
      history=recent;renderSuggestions();
    }).catch(()=>{ /* An unavailable history does not affect direct repository lookups. */ });
    const repositoriesPromise=request("repositories").then(result=>{
      if(modal!==dialog)return;
      mine=result.repositories||[];
      repositoriesLoading=false;
      renderSuggestions();
    }).catch(()=>{
      if(modal!==dialog)return;
      repositoriesLoading=false;
      repositoriesFailed=true;
      renderSuggestions();
    });
    await Promise.all([recentPromise,repositoriesPromise]);
  }
  function repositoryOptions() {
    return [...(id("gtg-options")?.querySelectorAll(".gtg-pick")||[])];
  }
  function setActiveRepository(name,scroll=false) {
    activeRepoName=name;
    const input=id("gtg-repo");
    let selected=null;
    for(const pick of repositoryOptions()){
      const active=!!name&&pick.dataset.repoName===name;
      pick.closest(".gtg-option-row").classList.toggle("gtg-keyboard-active",active);
      pick.setAttribute("aria-selected",String(active));
      if(active)selected=pick;
    }
    if(selected){
      input.setAttribute("aria-activedescendant",selected.id);
      if(scroll)selected.scrollIntoView({block:"nearest"});
    }else input.removeAttribute("aria-activedescendant");
  }
  function hideSuggestions(){
    const box=id("gtg-options");if(!box)return;
    box.hidden=true;
    id("gtg-repo").removeAttribute("aria-activedescendant");
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
    const entered=id("gtg-repo").value;
    const query=repoFrom(entered)||entered;
    const recent=history.filter(x=>repositoryMatches(x,query));
    const recentNames=new Set(recent.map(x=>x.toLowerCase()));
    const own=mine.filter(x=>repositoryMatches(x.repo,query)&&!recentNames.has(x.repo.toLowerCase()));
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
      }
      box.append(head);
      for(const item of items){
        const name=typeof item==="string"?item:item.repo;
        const line=document.createElement("div");line.className="gtg-option-row";
        const pick=document.createElement("button");
        pick.type="button";pick.className="gtg-pick";
        pick.id="gtg-repo-option-"+box.querySelectorAll(".gtg-pick").length;
        pick.dataset.repoName=name;
        pick.setAttribute("role","option");
        pick.innerHTML=miniIcons[isRecent?"history":item.private?"lock":"repository"];
        const nameEl=document.createElement("span");
        nameEl.className="gtg-pick-text";
        displayRepositoryMatch(nameEl,name,query);
        pick.setAttribute("aria-label",name);
        pick.append(nameEl);
        pick.addEventListener("click",()=>{
          // Only explicit selection replaces the user's exact typed text.
          id("gtg-repo").value=name;
          void choose(name);
          id("gtg-repo").focus({preventScroll:true});
        });
        pick.addEventListener("mousedown",event=>{
          if(event.button===0)event.preventDefault();
        });
        pick.addEventListener("mouseenter",()=>setActiveRepository(name));
        line.append(pick);
        if(!isRecent){
          const flag=document.createElement("span");flag.className="gtg-visibility";
          flag.textContent=item.private?"Private":"Public";line.append(flag);
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
    if(!box.childNodes.length){
      const empty=document.createElement("div");
      empty.className="gtg-empty";
      empty.textContent=repositoriesLoading?"Loading repositories...":
        repositoriesFailed?"Could not load repositories.":
        query.trim()?"No matching repositories.":"No repositories to show.";
      box.append(empty);
    }
    // Preserve the keyboard highlight across asynchronous inventory updates;
    // a newly typed query begins at the first matching result.
    const picks=repositoryOptions();
    if(entered!==activeRepoQuery){
      activeRepoQuery=entered;
      activeRepoName=entered.trim()?picks[0]?.dataset.repoName||"":"";
      box.scrollTop=0;
    }else if(!picks.some(pick=>pick.dataset.repoName===activeRepoName)){
      activeRepoName=entered.trim()?picks[0]?.dataset.repoName||"":"";
    }
    // Explicitly opening the dropdown must always display a panel.
    box.hidden=!wasOpen;
    const expanded=wasOpen;
    id("gtg-repo").setAttribute("aria-expanded",String(expanded));
    id("gtg-toggle").setAttribute("aria-expanded",String(expanded));
    if(expanded)setActiveRepository(activeRepoName);
    else id("gtg-repo").removeAttribute("aria-activedescendant");
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
    repoGen++;verified="";
    revisions.reset();
    hideLoading();
    id("gtg-revisions").hidden=true;
    id("gtg-verified").hidden=true;
    id("gtg-attach").disabled=true;
    status("");
  }
  function prepareRevisionLoading(){
    id("gtg-more-branches").hidden=true;
    showLoading();
  }
  async function choose(entered){
    if(!modal)return;
    clearTimeout(lookupTimer);resetRepo();
    const repo=repoFrom(entered);
    hideSuggestions();
    if(!repo){
      status("Could not find that repository.",true);
      return;
    }
    const gen=repoGen,dialog=modal;
    prepareRevisionLoading();
    try{
      await loadBranches(1,gen);
    }catch{
      if(gen!==repoGen||modal!==dialog)return;
      verified="";
      hideLoading();
      id("gtg-revisions").hidden=true;
      id("gtg-verified").hidden=true;
      id("gtg-attach").disabled=true;
      status("Could not find that repository.",true);
    }
  }
  globalThis.__gptTweaksGitHubSourceUI={launch,isEnabled,isOpen:()=>modal !== null};
})();
