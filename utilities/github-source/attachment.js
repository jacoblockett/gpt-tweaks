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
    if(busy||!getVerified())return;
    busy=true;let handedOff=false;
    id("gtg-attach").disabled=true;id("gtg-cancel").disabled=true;id("gtg-close").disabled=true;
    try{
      showLoading();
      const data=await request("zip",{repo:getVerified(),branch:id("gtg-branch").value,
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
