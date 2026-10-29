(() => {
  "use strict";
  if(globalThis.GPTTweaksHandoff)return;

  // Keep the handoff short enough to preserve useful context in the next chat.
  const prompt=[
    "GPT Tweaks session handoff request. Summarize this conversation for a new session; do not perform any tasks.",
    "Use the language predominantly used by the USER in this conversation, not the language of this instruction, quoted material, or assistant replies.",
    "If the user uses multiple languages, favor their most recent substantive conversation language. Write all sections naturally in that language.",
    "Output only plain Markdown text, with no file, attachment, download link, introduction, or conclusion.",
    "",
    "Aim for the brevity of 300–450 English words, never more than 600 English-word-equivalents of information. For languages without word spaces, be comparably concise.",
    "Shorter is better when the conversation is simple.",
    "This is an operational state transfer, not a narrative or full conversation history.",
    "Use short bullet points under these headings, translated into the user's language:",
    "## Goal — user's objective and desired outcome.",
    "## State — what is done, what remains, settled decisions, blockers and constraints.",
    "## Last 3 exchanges — one compact bullet per exchange: user request, outcome, unresolved issue; exclude this handoff request.",
    "## References — only essential files, repo paths, IDs, commands and preferences; distinguish verified from uncertain.",
    "## Next — exact stopping point, next likely priority, and essential questions, if any; do not start work.",
    "",
    "Prioritize facts necessary to resume accurately. Combine overlapping details and state each fact once.",
    "Omit obsolete debugging history, minor commits, repeated background, boilerplate and speculative details.",
    "Use exact identifiers only where needed for continuity. No tables or long paragraphs.",
    "Do not instruct the new session to execute tasks immediately."
  ].join("\n");
  const intake="Read the handoff below. Do not start any tasks. Briefly acknowledge readiness in the same language as the handoff; ask only if an essential missing detail prevents understanding.";
  const message=(action,extra={})=>chrome.runtime.sendMessage({
    type:"gpt-tweaks:handoff",action,...extra
  });
  const editor=()=>globalThis.__gptTweaksMenus?.composer()||
    document.querySelector('[data-testid="composer-text-input"],#prompt-textarea');
  const editorText=node=>("value" in node?node.value:node.innerText||node.textContent||"").trim();
  // This attribute is present on ChatGPT's actual composer in the supplied HTML.
  const effortButton=()=>document.querySelector(
    'button[aria-label="Select ChatGPT model"][data-composer-navigation-target="reasoning"][data-selected-reasoning-effort]');
  const selectedEffort=()=>effortButton()?.getAttribute("data-selected-reasoning-effort")||null;
  let enabled=false,busy=false,invalidated=false;

  function error(label,reason) {
    if(/Extension context invalidated/i.test(String(reason))){
      invalidated=true;return;
    }
    // No handoff error UI. Keep diagnostics in the extension console only.
    console.warn("[GPT Tweaks] "+label,reason);
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
  function sendButton(form) {
    // ChatGPT varies its submit control across composer layouts and versions.
    const selectors=[
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      '#composer-submit-button',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button.composer-submit-btn',
      'button[type="submit"]'
    ];
    for(const selector of selectors){
      const button=form.querySelector(selector);
      if(button&&!button.disabled&&button.getAttribute("aria-disabled")!=="true"&&
         button.getClientRects().length)return button;
    }
    return null;
  }
  async function submit(node) {
    const form=node.closest("form");
    if(!form)throw Error("ChatGPT composer form not found");
    // The control may appear only after ProseMirror registers the new text.
    // A real form submission is the fallback when ChatGPT renames the button.
    const button=await waitFor(()=>sendButton(form),3000).catch(reason=>{
      if(!/Timed out waiting for ChatGPT/.test(String(reason)))throw reason;
      return null;
    });
    if(button)button.click();
    else if(typeof form.requestSubmit==="function")form.requestSubmit();
    else throw Error("ChatGPT has no available send control");
    // Confirm the draft was actually submitted before awaiting a response
    // or deleting the pending transfer in the receiving conversation.
    await waitFor(()=>{
      const current=editor();
      return current&&!editorText(current);
    },10000);
  }
  async function send(text) {
    const node=await waitFor(editor);
    insert(node,text);
    await submit(node);
  }
  // Read the actual default model from ChatGPT's intercepted initialization
  // response. No additional network request and no assumed model label.
  function destinationModel(timeout=12000){
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        document.removeEventListener("gpt-tweaks:handoff:destination-model",onModel);
        resolve(value);
      };
      const onModel=event=>{
        const model=event.detail;
        if(typeof model==="string"&&/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(model))
          finish(model);
      };
      document.addEventListener("gpt-tweaks:handoff:destination-model",onModel);
      const timer=setTimeout(()=>finish(null),timeout);
      document.dispatchEvent(new Event("gpt-tweaks:handoff:request-destination-model"));
    });
  }
  async function matchEffort(wanted) {
    if(typeof wanted!=="string"||!/^[a-z][a-z0-9_-]{0,30}$/i.test(wanted))
      return false;
    const button=await waitFor(effortButton,5000).catch(()=>null);
    if(!button)return false;
    if(selectedEffort()===wanted)return true;
    // Open ChatGPT's real reasoning selector. Do not guess at its menu
    // structure or select a model by a similar-looking name.
    button.click();
    const menu=await waitFor(()=>{
      if(button.getAttribute("aria-expanded")!=="true")return null;
      const menuId=button.getAttribute("aria-controls");
      const element=menuId?document.getElementById(menuId):null;
      return element?.getAttribute("role")==="menu"&&
        element.getAttribute("aria-labelledby")===button.id ? element : null;
    },3000).catch(()=>null);
    if(!menu)return false;
    const names={low:"Low",medium:"Medium",high:"High",xhigh:"Extra High"};
    const label=names[wanted];
    if(!label)return false;
    const entries=[...menu.querySelectorAll('[role="menuitemradio"],[role="menuitem"]')]
      .filter(item=>item.getAttribute("aria-disabled")!=="true"&&
        !item.hasAttribute("data-disabled"));
    const title=item=>(item.getAttribute("aria-label")||item.textContent||"").trim();
    const options=entries.filter(item=>title(item)===label);
    // Require corroborating native effort choices in the same menu section.
    // A standalone "High" item is not enough evidence to change settings.
    const peers=options.length===1?
      entries.filter(item=>item.parentElement===options[0].parentElement&&
        Object.values(names).includes(title(item))) : [];
    if(options.length!==1||peers.length<2)return false;
    options[0].click();
    return !!(await waitFor(()=>selectedEffort()===wanted,4000).catch(()=>false));
  }
  function awaitHandoffText() {
    const id=crypto.randomUUID().replaceAll("-","");
    let settle,fail,timeout;
    const promise=new Promise((resolve,reject)=>{settle=resolve;fail=reject;});
    const listener=event=>{
      let packet;
      try{packet=JSON.parse(event.detail);}catch{return;}
      if(packet?.id!==id)return;
      cleanup();
      if(packet.ok&&typeof packet.text==="string")
        settle({text:packet.text,model:packet.model||null});
      else fail(Error(packet.error||"Handoff text capture failed"));
    };
    function cleanup(){
      clearTimeout(timeout);
      document.removeEventListener("gpt-tweaks:handoff:result",listener);
    }
    document.addEventListener("gpt-tweaks:handoff:result",listener);
    timeout=setTimeout(()=>{
      cleanup();
      fail(Error("Timed out waiting for handoff generation"));
    },10*60*1000);
    // Arm before submitting so the MAIN-world bridge sees this request.
    document.dispatchEvent(new CustomEvent("gpt-tweaks:handoff:arm",{detail:id}));
    return {
      promise,
      cancel(){
        document.dispatchEvent(new CustomEvent("gpt-tweaks:handoff:disarm",{detail:id}));
        cleanup();
      }
    };
  }
  async function generate() {
    const watch=awaitHandoffText();
    try {
      const [,text]=await Promise.all([send(prompt),watch.promise]);
      return text;
    } finally {
      watch.cancel();
    }
  }
  async function activate(method) {
    if(!["slash","menu"].includes(method)||!enabled||busy||invalidated)return;
    const node=editor();
    if(!node||editorText(node)){error("Finish or clear the current draft before /handoff");return;}
    busy=true;
    let closeToast=()=>{};
    try{
      closeToast=globalThis.GPTTweaksHandoffToast?.show()||closeToast;
      const sourcePath=location.pathname;
      const effort=selectedEffort();
      const {text,model}=await generate();
      const result=await message("prepare",{text,pathname:sourcePath,model,effort});
      if(!result?.ok)throw Error(result?.error||"Unable to save handoff");
      // Same tab; a project chat remains inside its originating project.
      location.assign(result.target);
    }catch(reason){error("Unable to complete handoff",reason);}
    finally{closeToast();busy=false;}
  }
  async function receive() {
    if(invalidated)return;
    try{
      const result=await message("read",{pathname:location.pathname});
      if(!result?.ok)throw Error(result?.error||"Unable to retrieve handoff");
      if(!result.pending)return;
      // Paste before resolving the destination model so the user retains
      // the complete draft even if the model or effort cannot be verified.
      const node=await waitFor(editor);
      insert(node,intake+"\n\n"+result.text);
      const currentModel=await destinationModel();
      let reason=null;
      if(!result.model||!currentModel)reason="unknown";
      else if(result.model!==currentModel)reason="model";
      else if(!await matchEffort(result.effort))reason="effort";
      if(reason){
        // The user must review and send manually. Acknowledging the dialog
        // never triggers submission, and a reload must not replay the paste.
        const done=await message("complete",{pathname:location.pathname});
        if(!done?.ok)throw Error(done?.error||"Unable to clear handoff");
        globalThis.GPTTweaksHandoffModelNotice?.show({
          sourceModel:result.model,destinationModel:currentModel,reason
        });
        return;
      }
      // Reconfirm the originating effort immediately before submission.
      if(selectedEffort()!==result.effort){
        const done=await message("complete",{pathname:location.pathname});
        if(!done?.ok)throw Error(done?.error||"Unable to clear handoff");
        globalThis.GPTTweaksHandoffModelNotice?.show({reason:"effort"});
        return;
      }
      await submit(node);
      const done=await message("complete",{pathname:location.pathname});
      if(!done?.ok)throw Error(done?.error||"Unable to clear handoff");
    }catch(reason){error("Unable to transfer handoff",reason);}
  }
  globalThis.GPTTweaksHandoff=Object.freeze({
    isEnabled:async method=>{
      if(method!=="slash"&&method!=="menu")return false;
      if(!enabled)await refresh();
      return enabled&&!invalidated;
    },
    activate
  });
  window.addEventListener("focus",()=>{void refresh();});
  void refresh();
  void receive();
})();