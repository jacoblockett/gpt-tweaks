(() => {
  "use strict";
  if (globalThis.__gptTweaksGitHubLoaded) return;
  globalThis.__gptTweaksGitHubLoaded = true;

  const COMMAND="/attach-github-source";
  const REPO=/^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]{1,100}$/i;
  let modal=null, busy=false, verified="", branchPage=0,commitPage=0,tip="",repoGen=0,commitGen=0;
  let history=[],mine=[],signedIn=false,slashAllowed=false;
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
  }
  async function launch(method) {
    if(!(await isEnabled(method)))return;
    if(modal)return;
    resetSlash();
    modal=document.createElement("dialog");
    modal.id="gtg-dialog";
    modal.setAttribute("aria-labelledby","gtg-heading");
    modal.innerHTML=[
      '<div class="gtg-header"><h2 id="gtg-heading">Attach GitHub Source</h2><button type="button" class="gtg-icon" id="gtg-close" aria-label="Close">×</button></div>',
      '<div class="gtg-body">',
      '<label class="gtg-label" for="gtg-repo">Repository</label>',
      '<div class="gtg-input-wrap"><input id="gtg-repo" type="text" autocomplete="off" spellcheck="false" placeholder="Search repositories or paste a GitHub URL" aria-controls="gtg-options" aria-expanded="false" /><button id="gtg-toggle" class="gtg-icon" type="button" aria-label="Show repositories">⌄</button></div>',
      '<div id="gtg-options" class="gtg-options" hidden></div>',
      '<div id="gtg-revisions" class="gtg-revisions" hidden><div><label class="gtg-label" for="gtg-branch">Branch</label><select id="gtg-branch"></select><button type="button" id="gtg-more-branches" class="gtg-more" hidden>Load more branches</button></div>',
      '<div><label class="gtg-label" for="gtg-commit">Commit</label><select id="gtg-commit"></select><button type="button" id="gtg-more-commits" class="gtg-more" hidden>Load older commits</button></div></div>',
      '<div class="gtg-auth" id="gtg-auth" hidden><p id="gtg-auth-prompt">Sign in to check access to private repositories.</p><button type="button" class="gtg-aux" id="gtg-login">Sign in with GitHub</button>',
      '<div id="gtg-device" hidden><div>Enter this code on GitHub:</div><strong id="gtg-device-code"></strong><button type="button" class="gtg-aux" id="gtg-open-device">Open GitHub verification</button></div></div>',
      '<div id="gtg-status" class="gtg-status" role="status" aria-live="polite"></div></div>',
      '<div class="gtg-footer"><button type="button" class="gtg-btn gtg-cancel" id="gtg-cancel">Cancel</button><button type="button" class="gtg-btn gtg-attach" id="gtg-attach" disabled>Attach</button></div>'
    ].join("");
    document.body.append(modal);
    modal.addEventListener("close",clearUi,{once:true});
    modal.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
    id("gtg-close").addEventListener("click",()=>modal.close());
    id("gtg-cancel").addEventListener("click",()=>modal.close());
    id("gtg-toggle").addEventListener("click",()=>{
      const box=id("gtg-options");box.hidden=!box.hidden;
      id("gtg-repo").setAttribute("aria-expanded",String(!box.hidden));
      if(!box.hidden)renderSuggestions();
    });
    id("gtg-repo").addEventListener("focus",()=>showSuggestions());
    id("gtg-repo").addEventListener("input",()=>{
      resetRepo();
      showSuggestions();
      clearTimeout(lookupTimer);
      const name=repoFrom(id("gtg-repo").value);
      if(name)lookupTimer=setTimeout(()=>choose(name),500);
    });
    id("gtg-repo").addEventListener("keydown",event=>{
      if(event.key==="Enter"){
        event.preventDefault();
        const repo=repoFrom(event.currentTarget.value);
        if(repo)choose(repo);
      } else if(event.key==="Escape"&&!id("gtg-options").hidden){
        event.stopPropagation();id("gtg-options").hidden=true;
      }
    });
    id("gtg-branch").addEventListener("change",()=>loadCommits(1));
    id("gtg-more-branches").addEventListener("click",()=>loadBranches(branchPage+1));
    id("gtg-more-commits").addEventListener("click",()=>loadCommits(commitPage+1));
    id("gtg-login").addEventListener("click",startLogin);
    id("gtg-open-device").addEventListener("click",()=>request("auth-open").catch(err=>status(err.message,true)));
    id("gtg-attach").addEventListener("click",attach);
    modal.showModal();
    id("gtg-repo").focus();
    try {
      const [recent,account,repositories]=await Promise.all([
        request("history"),request("auth-status"),request("repositories")
      ]);
      if(!modal)return;
      history=recent;mine=repositories;
      signedIn=Boolean(account.connected);
      id("gtg-auth").hidden=signedIn;
      if(!signedIn)id("gtg-auth-prompt").textContent="Sign in to list your repositories or access private repositories. Public URLs work without signing in.";
      renderSuggestions();
    }catch(err){status(err.message,true);}
  }
  function showSuggestions(){const box=id("gtg-options");if(!box)return;box.hidden=false;id("gtg-repo").setAttribute("aria-expanded","true");renderSuggestions();}
  function renderSuggestions(){
    const box=id("gtg-options");if(!box)return;
    box.replaceChildren();
    const query=id("gtg-repo").value.trim().toLowerCase();
    function makeGroup(label,list,isRecent){
      if(!list.length)return;
      const heading=document.createElement("div");heading.className="gtg-group";
      const title=document.createElement("span");title.textContent=label;heading.append(title);
      if(isRecent){
        const clear=document.createElement("button");clear.type="button";clear.textContent="Clear history";
        clear.addEventListener("click",async()=>{
          try{history=await request("history-clear");renderSuggestions();}catch(err){status(err.message,true);}
        });
        heading.append(clear);
      }
      box.append(heading);
      for(const row of list){
        const name=typeof row==="string"?row:row.repo;
        const line=document.createElement("div");line.className="gtg-option-row";
        const pick=document.createElement("button");pick.type="button";pick.className="gtg-pick";
        pick.textContent=name+(row.private?"  ·  Private":"");
        pick.addEventListener("click",()=>{id("gtg-repo").value=name;choose(name);});
        line.append(pick);
        if(isRecent){
          const remove=document.createElement("button");remove.type="button";remove.className="gtg-remove";
          remove.setAttribute("aria-label","Remove "+name+" from history");remove.textContent="×";
          remove.addEventListener("click",async()=>{
            try{history=await request("history-remove",{repo:name});renderSuggestions();}
            catch(err){status(err.message,true);}
          });
          line.append(remove);
        }
        box.append(line);
      }
    }
    const recent=history.filter(x=>x.toLowerCase().includes(query));
    makeGroup("Recently attached",recent,true);
    const recentNames=new Set(recent.map(x=>x.toLowerCase()));
    makeGroup("Your repositories",mine.filter(x=>x.repo.toLowerCase().includes(query)&&!recentNames.has(x.repo.toLowerCase())),false);
    if(!box.childNodes.length){
      const empty=document.createElement("p");empty.className="gtg-empty";
      empty.textContent=repoFrom(query)?"Press Enter to verify this repository.":"Enter owner/repo or paste a GitHub URL.";
      box.append(empty);
    }
  }
  function resetRepo(){
    repoGen++;commitGen++;verified="";branchPage=0;commitPage=0;tip="";
    const rev=id("gtg-revisions");if(rev)rev.hidden=true;
    const attachButton=id("gtg-attach");if(attachButton)attachButton.disabled=true;
    if(id("gtg-auth"))id("gtg-auth").hidden=signedIn;
  }
  async function choose(name){
    if(!id("gtg-repo"))return;
    clearTimeout(lookupTimer);resetRepo();
    const gen=repoGen;id("gtg-repo").value=name;id("gtg-options").hidden=true;
    status("Checking repository access…");
    try{
      await loadBranches(1,gen);
    }catch(err){
      if(gen!==repoGen)return;
      status(err.message,true);
      id("gtg-auth").hidden=false;
    }
  }
  async function loadBranches(page,generation=repoGen){
    const repo=repoFrom(id("gtg-repo").value);
    if(!repo)return;
    try{
      const data=await request("branches",{repo,page});
      if(generation!==repoGen)return;
      if(page===1){
        verified=data.repo;
        id("gtg-revisions").hidden=false;
        id("gtg-branch").replaceChildren();
        if(data.defaultBranch)id("gtg-branch").append(option(data.defaultBranch+" (default)",data.defaultBranch));
      }
      const select=id("gtg-branch");
      const existing=new Set([...select.options].map(x=>x.value));
      for(const b of data.branches)if(!existing.has(b)){select.append(option(b,b));existing.add(b);}
      branchPage=page;
      id("gtg-more-branches").hidden=!data.hasMore;
      if(page===1){
        if(!select.value)throw Error("Repository has no branches.");
        await loadCommits(1);
      }
    }catch(err){
      if(generation!==repoGen)return;
      status(err.message,true);
      if(page===1)id("gtg-auth").hidden=false;
    }
  }
  async function loadCommits(page){
    const generation=++commitGen;
    const repo=verified,branch=id("gtg-branch").value;
    if(!repo||!branch)return;
    id("gtg-attach").disabled=true;
    status("Loading commits…");
    try{
      const data=await request("commits",{repo,branch,page,...(page>1?{tip}:{})});
      if(generation!==commitGen||id("gtg-branch").value!==branch)return;
      const select=id("gtg-commit");
      if(page===1){
        tip=data.tip;
        select.replaceChildren(option("Latest branch tip",""));
      }
      const existing=new Set([...select.options].map(x=>x.value));
      for(const entry of data.commits){
        if(!existing.has(entry.sha)){
          select.append(option(entry.sha.slice(0,10)+" · "+entry.date+" · "+entry.message,entry.sha));
          existing.add(entry.sha);
        }
      }
      commitPage=page;
      id("gtg-more-commits").hidden=!data.hasMore;
      id("gtg-attach").disabled=false;
      status("Ready to attach "+repo+".");
    }catch(err){
      if(generation===commitGen)status(err.message,true);
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
    button.type="button";
    const content=button.querySelector('[data-menu-row-content="true"]');
    const label=content?.querySelector(':scope > span:last-child > span > span:first-child');
    const detail=content?.querySelector(':scope > span:last-child > span > span:last-child');
    const iconSlot=content?.querySelector('[data-leading-icon-slot="menu"]');
    if(!label||!detail||!iconSlot)return;
    label.textContent="Attach GitHub source";
    detail.textContent="Attach a repository ZIP";

    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("width","16");
    svg.setAttribute("height","16");
    svg.setAttribute("viewBox","0 0 16 16");
    svg.setAttribute("fill","currentColor");
    svg.setAttribute("aria-hidden","true");
    const path=document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d","M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.85c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z");
    svg.append(path);
    iconSlot.replaceChildren(svg);
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
  function resetSlash(){slashAllowed=false;if(slashSuggestion){slashSuggestion.remove();slashSuggestion=null;}}
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
    slashSuggestion.removeAttribute("aria-current");
    slashSuggestion.removeAttribute("aria-selected");
    slashSuggestion.classList.remove("bg-primary-ghost-hover","opacity-100");
    slashSuggestion.classList.add("menu-row-opacity");
    const menuLabel=slashSuggestion.querySelector(':scope > div > div > div > div');
    const menuDesc=slashSuggestion.querySelector(':scope > div > div > div > span');
    if(menuLabel&&menuDesc){
      menuLabel.textContent=COMMAND;
      menuDesc.textContent="Attach a GitHub repository";
      const icon=slashSuggestion.querySelector('[data-leading-icon-slot="menu"]');
      if(icon){
        const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
        svg.setAttribute("width","20");
        svg.setAttribute("height","20");
        svg.setAttribute("viewBox","0 0 16 16");
        svg.setAttribute("fill","currentColor");
        svg.setAttribute("aria-hidden","true");
        const path=document.createElementNS("http://www.w3.org/2000/svg","path");
        path.setAttribute("d","M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 4.85c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z");
        svg.append(path);icon.replaceChildren(svg);
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