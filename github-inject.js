(() => {
  "use strict";
  if (globalThis.__gptTweaksGitHubLoaded) return;
  globalThis.__gptTweaksGitHubLoaded = true;

  const COMMAND="/attach-github-source";
  const REPO=/^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]{1,100}$/i;
  let modal=null, busy=false, verified="", branchPage=0,commitPage=0,tip="",repoGen=0,commitGen=0;
  let history=[],mine=[],signedIn=false,authReady=false,accountName="",accountStatusPromise=null,slashAllowed=false;
  let observer=null,scanQueued=false,scanTimer=null,slashSuggestion=null,lookupTimer=null;
  const id=id=>modal?.querySelector("#"+id);
  const option=(label,value)=>{const e=document.createElement("option");e.textContent=label;e.value=value;return e;};
  const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  async function request(kind,fields={}) {
    const reply=await chrome.runtime.sendMessage({kind:"gpt-github-"+kind,...fields});
    if(!reply?.ok)throw Error(reply?.error||"GitHub operation failed.");
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
    repository:'<svg class="gtg-entry-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.85c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
    lock:'<svg class="gtg-entry-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="4.4" y="8.5" width="11.2" height="8.3" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 8.3V6a3 3 0 0 1 6 0v2.3M10 12v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
  };
  async function launch(method) {
    if(!(await isEnabled(method))||modal)return;
    resetSlash();
    signedIn=false;authReady=false;accountName="";history=[];mine=[];
    const dialog=document.createElement("dialog");
    modal=dialog;
    dialog.id="gtg-dialog";
    dialog.setAttribute("aria-labelledby","gtg-heading");
    dialog.innerHTML=[
      '<div class="gtg-header"><h2 id="gtg-heading">Attach GitHub Source</h2><button type="button" class="gtg-icon" id="gtg-close" aria-label="Close"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5 15 15M15 5 5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>',
      '<div class="gtg-body">',
      '<label class="gtg-label" for="gtg-repo">Repository</label>',
      '<div class="gtg-input-wrap">',searchIcon,'<input id="gtg-repo" type="text" autocomplete="off" spellcheck="false" placeholder="Search repositories or paste a GitHub URL" aria-controls="gtg-options" aria-expanded="false" />',
      '<span class="gtg-verified" id="gtg-verified" hidden>',checkIcon,'</span>',
      '<button id="gtg-toggle" class="gtg-icon" type="button" aria-label="Show repositories" aria-expanded="false">',caret,'</button></div>',
      '<div id="gtg-options" class="gtg-options" hidden></div>',
      '<div id="gtg-revisions" class="gtg-revisions" hidden>',
      '<div><label class="gtg-label" for="gtg-branch">Branch</label><div class="gtg-select-wrap"><select id="gtg-branch"></select>',caret,'</div><button type="button" id="gtg-more-branches" class="gtg-more" hidden>Load more branches</button></div>',
      '<div><label class="gtg-label" for="gtg-commit">Commit</label><div class="gtg-select-wrap"><select id="gtg-commit"></select>',caret,'</div><button type="button" id="gtg-more-commits" class="gtg-more" hidden>Load older commits</button></div>',
      '</div>',
      '<div class="gtg-auth" id="gtg-auth" hidden><p id="gtg-auth-prompt"></p><button type="button" class="gtg-aux" id="gtg-login">Sign in with GitHub</button>',
      '<div id="gtg-device" hidden><div>Enter this code on GitHub:</div><strong id="gtg-device-code"></strong><button type="button" class="gtg-aux" id="gtg-open-device">Open GitHub verification</button></div></div>',
      '<div id="gtg-status" class="gtg-status" role="status" aria-live="polite" hidden></div>',
      '</div><div class="gtg-footer"><button type="button" class="gtg-btn gtg-cancel" id="gtg-cancel">Cancel</button>',
      '<button type="button" class="gtg-btn gtg-attach" id="gtg-attach" disabled>Attach</button></div>'
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
      clearTimeout(lookupTimer);resetRepo();showSuggestions();
      const name=repoFrom(id("gtg-repo").value);
      if(name)lookupTimer=setTimeout(()=>choose(name),450);
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
    id("gtg-more-branches").addEventListener("click",()=>loadBranches(branchPage+1,repoGen).catch(err=>status(err.message,true)));
    id("gtg-more-commits").addEventListener("click",()=>loadCommits(commitPage+1,repoGen));
    id("gtg-login").addEventListener("click",startLogin);
    id("gtg-open-device").addEventListener("click",()=>request("auth-open").catch(err=>status(err.message,true)));
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
      mine=await request("repositories");
      if(modal===dialog)renderSuggestions();
    }catch(err){if(modal===dialog)status(err.message,true);}
  }
  function hideSuggestions(){
    const box=id("gtg-options");if(!box)return;
    box.hidden=true;
    id("gtg-repo").setAttribute("aria-expanded","false");
    id("gtg-toggle").setAttribute("aria-expanded","false");
  }
  function showSuggestions(){
    const box=id("gtg-options");if(!box)return;
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
    // An empty suggestion list is not an input placeholder or a visible panel.
    box.hidden=!box.childNodes.length||!wasOpen;
    const expanded=!box.hidden;
    id("gtg-repo").setAttribute("aria-expanded",String(expanded));
    id("gtg-toggle").setAttribute("aria-expanded",String(expanded));
  }
  function resetRepo(){
    repoGen++;commitGen++;verified="";branchPage=0;commitPage=0;tip="";
    id("gtg-revisions").hidden=true;
    id("gtg-verified").hidden=true;
    id("gtg-attach").disabled=true;
    id("gtg-auth").hidden=true;
    status("");
  }
  function prepareRevisionLoading(){
    id("gtg-revisions").hidden=false;
    id("gtg-branch").replaceChildren(option("Loading branches…",""));
    id("gtg-commit").replaceChildren(option("Waiting for branch…",""));
    id("gtg-branch").disabled=true;
    id("gtg-commit").disabled=true;
    id("gtg-more-branches").hidden=true;
    id("gtg-more-commits").hidden=true;
  }
  async function choose(name){
    if(!modal||!repoFrom(name))return;
    clearTimeout(lookupTimer);resetRepo();
    const gen=repoGen,dialog=modal;
    id("gtg-repo").value=name;
    hideSuggestions();
    prepareRevisionLoading();
    status("Checking repository…");
    try{
      await loadBranches(1,gen);
    }catch(err){
      if(gen!==repoGen||modal!==dialog)return;
      id("gtg-revisions").hidden=true;
      id("gtg-verified").hidden=true;
      status(err.message,true);
      if(err.code==="REPOSITORY_UNAVAILABLE"){
        if(accountStatusPromise)await accountStatusPromise;
        if(gen!==repoGen||modal!==dialog)return;
        if(authReady&&!signedIn){
          id("gtg-auth-prompt").textContent="This repository couldn't be found. If it's private, sign in with GitHub to check your access.";
          id("gtg-auth").hidden=false;
          status("");
        }
      }
    }
  }
  async function loadBranches(page,generation=repoGen){
    const repo=repoFrom(id("gtg-repo")?.value);
    if(!repo)return;
    const data=await request("branches",{repo,page});
    if(generation!==repoGen||!modal)return;
    if(page===1){
      verified=data.repo;
      const branch=id("gtg-branch");
      branch.replaceChildren();
      if(data.defaultBranch)branch.append(option(data.defaultBranch,data.defaultBranch));
      id("gtg-revisions").hidden=false;
      id("gtg-verified").hidden=false;
    }
    const branch=id("gtg-branch");
    const existing=new Set([...branch.options].map(x=>x.value));
    for(const name of data.branches){
      if(!existing.has(name)){branch.append(option(name,name));existing.add(name);}
    }
    branchPage=page;
    branch.disabled=false;
    id("gtg-more-branches").hidden=!data.hasMore;
    if(page===1){
      if(!branch.value)throw Error("Repository has no branches.");
      id("gtg-commit").replaceChildren(option("Loading commits…",""));
      id("gtg-commit").disabled=true;
      status("Loading commits…");
      await loadCommits(1,generation);
    }
  }
  async function loadCommits(page,generation=repoGen){
    const branch=id("gtg-branch")?.value,repo=verified;
    if(!repo||!branch)return;
    const commitRequest=++commitGen;
    if(page===1){
      id("gtg-attach").disabled=true;
      id("gtg-commit").replaceChildren(option("Loading commits…",""));
      id("gtg-commit").disabled=true;
    }
    status(page===1?"Loading commits…":"Loading more commits…");
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
      id("gtg-more-commits").hidden=!data.hasMore;
      id("gtg-attach").disabled=false;
      status("");
    }catch(err){
      if(generation===repoGen&&commitRequest===commitGen)status(err.message,true);
    }
  }
  async function startLogin(){
    id("gtg-login").disabled=true;
    try{
      const data=await request("auth-start");
      if(!modal)return;
      id("gtg-device").hidden=false;
      id("gtg-device-code").textContent=data.user_code;
      status("Approve this code in GitHub to connect your account.");
      await request("auth-open");
      const expiry=Date.now()+data.expires_in*1000;
      let interval=data.interval*1000;
      while(modal&&Date.now()<expiry){
        await new Promise(resolve=>setTimeout(resolve,interval));
        if(!modal)return;
        const result=await request("auth-poll");
        if(result.connected){
          signedIn=true;
          id("gtg-auth").hidden=true;
          mine=await request("repositories");
          status("Signed in as "+result.account+".");
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
      status("Downloading source ZIP…");
      const data=await request("zip",{repo:verified,branch:id("gtg-branch").value,
        commit:id("gtg-commit").value});
      const file=new File([base64Bytes(data.base64)],data.filename,{type:"application/zip"});
      const composer=localComposer();
      const before=composerAttachmentState(composer,file.name);
      if(!uploadFile(file))throw Error("ChatGPT file uploader could not be found.");
      handedOff=true;
      status("Waiting for ChatGPT to display the attachment…");
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
    }catch(err){status(err.message,true);}
    finally{
      busy=false;
      if(id("gtg-cancel"))id("gtg-cancel").disabled=false;
      if(id("gtg-close"))id("gtg-close").disabled=false;
      // An unconfirmed handoff may still be uploading. Do not allow an accidental duplicate.
      if(id("gtg-attach"))id("gtg-attach").disabled=!verified||handedOff;
    }
  }

  // Preserve ChatGPT's compact and leading icon wrappers and dimensions.
  const GITHUB_MARK="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.85c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z";
  function setGitHubIcon(iconSlot){
    const originals=[...iconSlot.querySelectorAll("svg")];
    if(!originals.length) return;
    for(const old of originals){
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.setAttribute("aria-hidden","true");
      svg.setAttribute("focusable","false");
      svg.setAttribute("width",old.getAttribute("width")||"20");
      svg.setAttribute("height",old.getAttribute("height")||"20");
      svg.setAttribute("viewBox","0 0 16 16");
      svg.setAttribute("fill","currentColor");
      svg.setAttribute("class",old.getAttribute("class")||"");
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",GITHUB_MARK);
      svg.append(path);
      old.replaceWith(svg);
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
    label.textContent="Attach GitHub source";
    detail.textContent="Attach a repository ZIP";

    setGitHubIcon(iconSlot);
    styleInjectedMenuRow(button);
    button.addEventListener("mousedown",event=>event.preventDefault());
    button.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      launch("menu");
    });
    element.after(button);
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
      else existing?.remove();
    }catch{}
  }
  function resetSlash(){slashAllowed=false;if(slashSuggestion){if(virtualRow===slashSuggestion)clearVirtualRow();slashSuggestion.remove();slashSuggestion=null;}}
  async function updateSlash(){
    const composer=localComposer();
    const typed=editableText(composer);
    if(!typed.startsWith("/")||!COMMAND.startsWith(typed)){
      resetSlash();return;
    }
    if(slashSuggestion?.isConnected)return;
    try{if(!(await isEnabled("slash"))){resetSlash();return;}slashAllowed=true;}catch{slashAllowed=false;return;}
    const current=editableText(localComposer());
    if(!current.startsWith("/")||!COMMAND.startsWith(current)||slashSuggestion?.isConnected)return;
    const rows=[...document.querySelectorAll('[data-mention-section-id="commands"] [data-mention-section-items="true"] > button[data-list-navigation-item="true"]')]
      .filter(el=>visible(el)&&!el.dataset.gtgSlash);
    const native=rows.find(el=>!el.hasAttribute("aria-current"))||rows[0];
    if(!native)return; // Never place an out-of-menu fallback inside the composer.
    slashSuggestion=native.cloneNode(true);
    slashSuggestion.type="button";
    slashSuggestion.id="gtg-slash";
    slashSuggestion.dataset.gtgSlash="true";
    // Do not shift native React's scroll indexes with an unregistered row.
    slashSuggestion.removeAttribute("data-list-navigation-item");
    styleInjectedMenuRow(slashSuggestion);
    const menuLabel=slashSuggestion.querySelector(':scope > div > div > div > div');
    const menuDesc=slashSuggestion.querySelector(':scope > div > div > div > span');
    if(menuLabel&&menuDesc){
      menuLabel.textContent=COMMAND;
      menuDesc.textContent="Attach a GitHub repository";
      const icon=slashSuggestion.querySelector('[data-leading-icon-slot="menu"]');
      if(icon){
        setGitHubIcon(icon);
      }
      // Keep the button's native layout and menu navigation attributes.
      native.before(slashSuggestion);
    }else{
      slashSuggestion=null;
      return; // Captured layout no longer matches: do not create a misleading button.
    }
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
    if(!composer)return;
    const typed=editableText(composer);
    if(typed.startsWith("/")&&COMMAND.startsWith(typed)){
      // ProseMirror tracks its document internally: perform a browser edit,
      // not a raw textContent replacement that can desynchronize its state.
      composer.focus();
      const range=document.createRange();
      range.selectNodeContents(composer);
      const selection=window.getSelection();
      selection.removeAllRanges();selection.addRange(range);
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
    if(modal||event.isComposing||event.altKey||event.metaKey)return;
    const active=[...document.querySelectorAll('[data-gtg-menu-option="true"],#gtg-slash')]
      .filter(row=>visible(row));
    if(active.length!==1){clearVirtualRow();return;}
    const row=active[0];
    if(virtualRow&&virtualRow!==row)clearVirtualRow();
    const parent=row.parentElement;
    const prev=nativeNeighbor(row,-1),next=nativeNeighbor(row,1);
    if(!parent||!prev||!next)return;
    const nativeSelected=[...parent.querySelectorAll(':scope > button[data-list-navigation-item="true"]')]
      .find(node=>node.getAttribute("aria-current")==="true" ||
        node.classList.contains("bg-primary-ghost-hover"));
    if(event.key==="Escape"){clearVirtualRow();return;}
    if(virtualRow===row){
      if(event.key==="Enter"||event.key==="Tab"){
        event.preventDefault();event.stopImmediatePropagation();
        clearVirtualRow();row.click();return;
      }
      if(event.key==="ArrowDown"||event.key==="ArrowUp"){
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
      clearVirtualRow();
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
  document.addEventListener("keydown",event=>{
    const composer=localComposer();
    if(!composer||!composer.contains(event.target))return;
    if(slashAllowed&&event.key==="Enter"&&!event.shiftKey&&!event.isComposing&&editableText(composer)===COMMAND){
      event.preventDefault();event.stopImmediatePropagation();clearComposerCommand();launch("slash");
    }
  },true);
  document.addEventListener("input",event=>{
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
  observer.observe(document.documentElement,{childList:true,subtree:true});
  scheduleScan();
})();