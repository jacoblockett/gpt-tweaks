(() => {
  "use strict";
  if(globalThis.GPTTweaksHandoff)return;

  // This is the user-approved, conversation-agnostic handoff request.
  const prompt=[
    "為本對話製交接文件，供新會話承續。僅述現況，勿執行任務。",
    "",
    "以 Markdown 記：",
    "",
    "1. **總旨**：用戶之目標、背景及預期成果。",
    "2. **現況**：當前議題、已成事項、未決問題、既定決策與限制。",
    "3. **近 3 輪對話**：逐輪述用戶所言、助理所答、所得結論及遺留問題；不計本次交接請求。",
    "4. **重要依據**：相關文件、資源、路徑、指令及偏好；註明何者已驗證，何者尚待查證或重新取得。",
    "5. **接續方向**：說明對話止於何處、後續應關注何事，以及有無須向用戶確認之問題。勿要求新會話立即執行。",
    "",
    "務求完整而精簡。已知與推測分明，勿臆造、重述或遺漏要事。新會話即使無舊對話記錄，亦應能據此理解全局。",
    "",
    "建立 `Session-Handoff.md`，內載完整交接內容。",
    "",
    "**回覆唯附此 Markdown 檔。勿加文字、預覽、解釋或結語。**"
  ].join("\n");
  const intake="Read the session handoff below, ask only about unresolved issues you cannot reconcile yourself, and otherwise acknowledge receipt and readiness to continue without starting any work.";
  const message=(action,extra={})=>chrome.runtime.sendMessage({
    type:"gpt-tweaks:handoff",action,...extra
  });
  const editor=()=>globalThis.__gptTweaksMenus?.composer()||
    document.querySelector('[data-testid="composer-text-input"],#prompt-textarea');
  const assistantMessages=()=>[...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const editorText=node=>("value" in node?node.value:node.innerText||node.textContent||"").trim();
  let enabled=false,busy=false,invalidated=false;

  function error(label,reason) {
    if(/Extension context invalidated/i.test(String(reason))){
      invalidated=true;return;
    }
    console.warn("[GPT Tweaks] "+label,reason);
    const form=editor()?.closest("form");
    if(!form)return;
    let notice=form.querySelector('[data-gt-handoff-error]');
    if(!notice){
      notice=document.createElement("div");
      notice.dataset.gtHandoffError="true";
      notice.setAttribute("role","status");
      notice.style.cssText="font-size:12px;padding:4px 8px;color:var(--text-secondary,#aaa)";
      form.append(notice);
    }
    notice.textContent="Session handoff: "+label;
  }
  async function refresh(){
    if(invalidated)return;
    try{
      const result=await message("status");
      enabled=!!(result?.ok&&result.enabled);
    }catch(reason){error("Settings unavailable",reason);}
  }
  function waitFor(check,timeout=20000) {
    return new Promise((resolve,reject)=>{
      const start=Date.now();
      const timer=setInterval(()=>{
        let value;
        try{value=check();}catch(reason){cleanup();reject(reason);return;}
        if(value){cleanup();resolve(value);}
        else if(Date.now()-start>timeout){
          cleanup();reject(Error("Timed out waiting for ChatGPT"));
        }
      },250);
      function cleanup(){clearInterval(timer);}
    });
  }
  function insert(node,text) {
    if(editorText(node))throw Error("Composer must be empty");
    node.focus();
    if(node.matches("textarea,input")){
      const proto=Object.getPrototypeOf(node);
      const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
      if(setter)setter.call(node,text);
      else node.value=text;
      node.dispatchEvent(new Event("input",{bubbles:true}));
    }else{
      const range=document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection=window.getSelection();
      selection.removeAllRanges();selection.addRange(range);
      if(!document.execCommand("insertText",false,text))
        throw Error("ChatGPT rejected composer insertion");
    }
    const normalized=value=>value.replace(/[\s\u00a0]+/g,"");
    if(normalized(editorText(node))!==normalized(text))
      throw Error("Composer did not accept the complete handoff text");
  }
  async function send(text) {
    const node=await waitFor(editor);
    insert(node,text);
    const form=node.closest("form");
    if(!form)throw Error("ChatGPT composer form not found");
    const selector='button[data-testid="send-button"],button[data-testid="composer-send-button"],button[aria-label="Send prompt"],button[aria-label="Send message"],#composer-submit-button';
    const button=await waitFor(()=>{
      const found=form.querySelector(selector);
      return found&&!found.disabled?found:null;
    },10000);
    button.click();
  }
  function fileLinks(messageNode){
    return [...messageNode.querySelectorAll("a[href],a[download]")].filter(link=>{
      const label=[link.textContent,link.getAttribute("download"),link.getAttribute("href")]
        .filter(Boolean).join(" ");
      try{return decodeURIComponent(label).toLowerCase().includes("session-handoff.md");}
      catch{return label.toLowerCase().includes("session-handoff.md");}
    });
  }
  async function downloadMarkdown(link) {
    const raw=link.getAttribute("href");
    if(!raw)throw Error("File has no downloadable link");
    const url=new URL(raw,location.href);
    if(!["https:","http:","blob:","data:"].includes(url.protocol))
      throw Error("Handoff file URL cannot be read");
    const response=await fetch(url.href,{credentials:"include"});
    if(!response.ok||response.type==="opaque")throw Error("Unable to retrieve handoff file");
    const type=response.headers.get("content-type")||"";
    if(/text\/html/i.test(type))throw Error("File download returned HTML");
    const text=await response.text();
    if(text.length<80||text.length>512000)throw Error("Handoff content is missing or too large");
    return text.replace(/\r\n/g,"\n");
  }
  function generating() {
    return !!document.querySelector('button[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="Stop response"]');
  }
  async function generate() {
    const before=assistantMessages().length;
    await send(prompt);
    // Only consider the new answer, never a file in earlier conversation turns.
    await waitFor(()=>assistantMessages().length>before,10*60*1000);
    let completedAt=null;
    const link=await waitFor(()=>{
      if(generating()){completedAt=null;return null;}
      for(const answer of assistantMessages().slice(before)){
        const found=fileLinks(answer)[0];
        if(found)return found;
      }
      if(completedAt===null)completedAt=Date.now();
      if(Date.now()-completedAt>10000)
        throw Error("ChatGPT did not provide Session-Handoff.md");
      return null;
    },10*60*1000);
    // Give React time to finish committing the final file attachment.
    await new Promise(resolve=>setTimeout(resolve,750));
    if(!link.isConnected||generating())throw Error("Handoff response changed before capture");
    return downloadMarkdown(link);
  }
  async function activate(method) {
    if(method!=="slash"||!enabled||busy||invalidated)return;
    const node=editor();
    if(!node||editorText(node)){error("Finish or clear the current draft before /handoff");return;}
    busy=true;
    try{
      const sourcePath=location.pathname;
      const text=await generate();
      const result=await message("prepare",{text,pathname:sourcePath});
      if(!result?.ok)throw Error(result?.error||"Unable to save handoff");
      // Same tab; a project chat remains inside its originating project.
      location.assign(result.target);
    }catch(reason){error("Unable to complete handoff",reason);}
    finally{busy=false;}
  }
  async function receive() {
    if(invalidated)return;
    try{
      const result=await message("read",{pathname:location.pathname});
      if(!result?.ok)throw Error(result?.error||"Unable to retrieve handoff");
      if(!result.pending)return;
      await send(intake+"\n\n"+result.text);
      const done=await message("complete",{pathname:location.pathname});
      if(!done?.ok)throw Error(done?.error||"Unable to clear handoff");
    }catch(reason){error("Unable to transfer handoff",reason);}
  }
  globalThis.GPTTweaksHandoff=Object.freeze({
    isEnabled:async method=>{
      if(method!=="slash")return false;
      if(!enabled)await refresh();
      return enabled&&!invalidated;
    },
    activate
  });
  window.addEventListener("focus",()=>{void refresh();});
  void refresh();
  void receive();
})();