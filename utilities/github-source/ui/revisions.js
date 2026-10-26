(() => {
"use strict";
globalThis.__gptTweaksCreateRevisions=helpers=>{
  const {id,option,request,repoFrom,status,showLoading,hideLoading,hideSuggestions,
    getRepoGen,getModal,getVerified,setVerified}=helpers;
  const COMMIT_WINDOW=10,COMMIT_ROW_HEIGHT=36;
  let branchPage=0,commitPage=0,tip="",commitGen=0;
  let commitEntries=[],commitHasMore=false,commitLoading=false;
  function hideRevisionMenus(){
    for(const kind of ["branch","commit"]){
      const panel=id("gtg-"+kind+"-list"),trigger=id("gtg-"+kind+"-trigger");
      if(panel)panel.hidden=true;
      trigger?.setAttribute("aria-expanded","false");
    }
  }
  function commitChoice(index){
    if(index===0)return {value:"",text:"Latest"};
    const item=commitEntries[index-1];
    return {value:item.sha,text:item.sha.slice(0,10)+" · "+item.date+" · "+item.message};
  }
  function selectCommit(index){
    const select=id("gtg-commit"),trigger=id("gtg-commit-trigger");
    const choice=commitChoice(index);
    const changed=select.value!==choice.value;
    select.replaceChildren(option("Latest",""));
    if(choice.value)select.append(option(choice.text,choice.value));
    select.value=choice.value;
    hideRevisionMenus();
    syncRevisionTriggers();
    if(changed)select.dispatchEvent(new Event("change",{bubbles:true}));
    trigger.focus();
  }
  function renderCommitWindow(){
    const panel=id("gtg-commit-list");
    if(!panel||panel.hidden)return;
    const total=commitEntries.length+1;
    const start=Math.min(Math.floor(panel.scrollTop/COMMIT_ROW_HEIGHT),Math.max(0,total-COMMIT_WINDOW));
    const end=Math.min(total,start+COMMIT_WINDOW);
    const focused=panel.contains(document.activeElement)?
      Number(document.activeElement.dataset.commitIndex):-1;
    const above=document.createElement("div");
    above.className="gtg-commit-spacer";
    above.style.height=(start*COMMIT_ROW_HEIGHT)+"px";
    above.setAttribute("aria-hidden","true");
    const elements=[above];
    for(let index=start;index<end;index++){
      const choice=commitChoice(index),row=document.createElement("button");
      row.type="button";row.className="gtg-revision-option";
      row.dataset.commitIndex=String(index);
      row.setAttribute("role","option");
      row.setAttribute("aria-selected",String(choice.value===id("gtg-commit").value));
      row.setAttribute("aria-setsize",String(total));
      row.setAttribute("aria-posinset",String(index+1));
      row.textContent=choice.text;row.title=choice.text;
      row.addEventListener("click",()=>selectCommit(index));
      elements.push(row);
    }
    const below=document.createElement("div");
    below.className="gtg-commit-spacer";
    below.style.height=((total-end)*COMMIT_ROW_HEIGHT)+"px";
    below.setAttribute("aria-hidden","true");
    elements.push(below);
    panel.replaceChildren(...elements);
    if(Number.isInteger(focused)&&focused>=0){
      const row=elements.find(el=>Number(el.dataset?.commitIndex)===focused);
      if(row)row.focus({preventScroll:true});
      else panel.focus({preventScroll:true});
    }
  }
  function checkMoreCommits(){
    const panel=id("gtg-commit-list");
    if(!panel||panel.hidden||!commitHasMore||commitLoading||!commitPage)return;
    if(panel.scrollTop+panel.clientHeight>=panel.scrollHeight-COMMIT_ROW_HEIGHT)
      void loadCommits(commitPage+1,getRepoGen());
  }
  function showCommitMenu(trigger,panel){
    const select=id("gtg-commit");
    panel.hidden=false;trigger.setAttribute("aria-expanded","true");
    const selected=select.value?commitEntries.findIndex(x=>x.sha===select.value)+1:0;
    panel.scrollTop=Math.max(0,selected)*COMMIT_ROW_HEIGHT;
    renderCommitWindow();
    const focusIndex=selected>=0?selected:0;
    const initial=[...panel.querySelectorAll(".gtg-revision-option")]
      .find(row=>Number(row.dataset.commitIndex)===focusIndex);
    (initial||panel).focus({preventScroll:true});
    panel.onscroll=()=>{
      if(panel.hidden)return;
      renderCommitWindow();
      checkMoreCommits();
    };
    panel.onkeydown=event=>{
      if(event.key==="Escape"){
        event.preventDefault();hideRevisionMenus();trigger.focus();return;
      }
      if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
      event.preventDefault();
      const active=Number(document.activeElement?.dataset.commitIndex);
      const fallback=select.value?commitEntries.findIndex(x=>x.sha===select.value)+1:0;
      const index=Number.isInteger(active)&&panel.contains(document.activeElement)?active:Math.max(0,fallback);
      const total=commitEntries.length+1;
      const next=event.key==="Home"?0:event.key==="End"?total-1:
        (index+(event.key==="ArrowDown"?1:-1)+total)%total;
      const viewport=Math.max(1,Math.floor(panel.clientHeight/COMMIT_ROW_HEIGHT));
      if(next*COMMIT_ROW_HEIGHT<panel.scrollTop)
        panel.scrollTop=next*COMMIT_ROW_HEIGHT;
      else if((next+1)*COMMIT_ROW_HEIGHT>panel.scrollTop+panel.clientHeight)
        panel.scrollTop=Math.max(0,(next+1)*COMMIT_ROW_HEIGHT-viewport*COMMIT_ROW_HEIGHT);
      renderCommitWindow();
      const row=[...panel.querySelectorAll(".gtg-revision-option")]
        .find(button=>Number(button.dataset.commitIndex)===next);
      (row||panel).focus({preventScroll:true});
      checkMoreCommits();
    };
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
    if(kind==="commit"){
      showCommitMenu(trigger,panel);
      return;
    }
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
  async function loadBranches(page,generation=getRepoGen()){
    const repo=repoFrom(id("gtg-repo")?.value);
    if(!repo)return;
    if(page>1)showLoading();
    try{
      const data=await request("branches",{repo,page});
      if(generation!==getRepoGen()||!getModal())return;
      if(page===1){
        setVerified(data.repo);
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
      if(generation===getRepoGen()&&getModal()){
        hideLoading();
        if(page>1){id("gtg-revisions").hidden=false;id("gtg-attach").disabled=false;}
      }
      throw err;
    }
  }
  async function loadCommits(page,generation=getRepoGen()){
    const branch=id("gtg-branch")?.value,repo=getVerified();
    if(!repo||!branch)return;
    if(page>1&&(!commitHasMore||commitLoading||page!==commitPage+1))return;
    const commitRequest=++commitGen;
    if(page===1){
      commitPage=0;
      commitEntries=[];
      commitHasMore=false;
      commitLoading=false;
      tip="";
      showLoading();
    }else commitLoading=true;
    try{
      const data=await request("commits",{repo,branch,page,...(page>1?{tip}:{})});
      if(generation!==getRepoGen()||commitRequest!==commitGen||!getModal()||id("gtg-branch").value!==branch)return;
      const commit=id("gtg-commit");
      if(page===1){
        tip=data.tip;
        commit.replaceChildren(option("Latest",""));
      }
      const existing=new Set(commitEntries.map(x=>x.sha));
      for(const entry of data.commits){
        if(!existing.has(entry.sha)){
          commitEntries.push(entry);
          existing.add(entry.sha);
        }
      }
      commitPage=page;
      commitHasMore=!!data.hasMore;
      commitLoading=false;
      commit.disabled=false;
      syncRevisionTriggers();
      if(page===1){
        id("gtg-verified").hidden=false;
        hideLoading();
        id("gtg-revisions").hidden=false;
        id("gtg-attach").disabled=false;
      }else if(!id("gtg-commit-list").hidden){
        renderCommitWindow();
      }
    }catch(err){
      if(generation===getRepoGen()&&commitRequest===commitGen&&getModal()){
        commitLoading=false;
        if(page>1)status("Could not load commits.",true);
        else hideLoading();
      }
      if(page===1)throw err;
    }
  }

  function reset(){
    commitGen++;branchPage=0;commitPage=0;tip="";
    commitEntries=[];commitHasMore=false;commitLoading=false;
  }
  function cancel(){commitGen++;}
  return {reset,cancel,hideRevisionMenus,showRevisionMenu,toggleRevisionMenu,
    renderCommitWindow,loadBranches,loadCommits,syncRevisionTriggers,
    getBranchPage:()=>branchPage};
};
})();