(() => {
  "use strict";
  globalThis.__gptTweaksCreateAttachment=helpers=>{
    const {id,request,showLoading,hideLoading,status,localComposer,
      getModal,getVerified,setHistory}=helpers;
    let busy=false;
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
    inputs.sort((a,b)=>(form?.contains(b) ? 1 : 0)-(form?.contains(a) ? 1 : 0));
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
  function composerAttachmentState(filename){
    // ChatGPT may replace the composer during upload. Resolve the current,
    // visible form on every check, not an editor captured before the handoff.
    const editor=localComposer();
    const candidate=editor?.closest("form[data-chatgpt-composer]");
    const form=candidate?.isConnected&&candidate.getClientRects().length?candidate:
      [...document.querySelectorAll("form[data-chatgpt-composer]")]
        .find(form=>form.getClientRects().length);
    const root=form?.querySelector("[data-composer-attachments]");
    if(!root?.isConnected||!root.getClientRects().length)return {count:0,named:0};
    // The outer attachment container has a layout wrapper; count file cards.
    const cards=[...root.querySelectorAll('[class~="group/composer-attachment"]')];
    const named=cards.filter(card=>
      (card.textContent||"").includes(filename) ||
      [...card.querySelectorAll("[aria-label],[title],[alt]")].some(el=>
        ["aria-label","title","alt"].some(attr=>(el.getAttribute(attr)||"")===filename))
    ).length;
    return {count:cards.length,named};
  }
  async function attach(){
    if(busy||!getVerified())return;
    busy=true;let handedOff=false;
    id("gtg-attach").disabled=true;id("gtg-cancel").disabled=true;id("gtg-close").disabled=true;
    try{
      showLoading();
      const data=await request("zip",{repo:getVerified(),branch:id("gtg-branch").value,
        commit:id("gtg-commit").value});
      const file=new File([base64Bytes(data.base64)],data.filename,{type:"application/zip"});
      const before=composerAttachmentState(file.name);
      if(!uploadFile(file))throw Error("ChatGPT file uploader could not be found.");
      handedOff=true;
      let shown=false;
      for(let i=0;i<120;i++){
        await new Promise(resolve=>setTimeout(resolve,250));
        const after=composerAttachmentState(file.name);
        if(after.named>before.named){shown=true;break;}
      }
      if(!shown)throw Error("Attachment handoff was attempted, but no new composer attachment was confirmed. Check the composer before retrying.");
      try{setHistory(await request("history-add",{repo:getVerified()}));}
      catch(err){status("Attachment displayed, but history could not be saved: "+err.message,true);return;}
      getModal()?.close();
    }catch(err){
      hideLoading();
      if(getModal()&&getVerified())id("gtg-revisions").hidden=false;
      status(err.message,true);
    }
    finally{
      busy=false;
      if(id("gtg-cancel"))id("gtg-cancel").disabled=false;
      if(id("gtg-close"))id("gtg-close").disabled=false;
      if(getModal()&&id("gtg-loading")&&!id("gtg-loading").hidden)hideLoading();
      // An unconfirmed handoff may still be uploading. Do not allow an accidental duplicate.
      if(id("gtg-attach"))id("gtg-attach").disabled=!getVerified()||handedOff;
    }
  }



    return {attach,isBusy:()=>busy,reset:()=>{busy=false;}};
  };
})();
