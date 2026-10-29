/* Receiving-chat notice. Acknowledging never submits the prepared draft. */
(() => {
  "use strict";
  if(globalThis.GPTTweaksHandoffModelNotice)return;
  function show({sourceModel=null,destinationModel=null,reason="model"}={}){
    document.getElementById("gtg-handoff-model-notice")?.remove();
    const dialog=document.createElement("dialog");
    dialog.id="gtg-handoff-model-notice";
    dialog.setAttribute("aria-labelledby","gtg-handoff-model-title");
    dialog.setAttribute("aria-describedby","gtg-handoff-model-description");
    const heading=document.createElement("h2");
    heading.id="gtg-handoff-model-title";
    heading.textContent="Handoff not sent";
    const explanation=document.createElement("p");
    explanation.id="gtg-handoff-model-description";
    if(reason==="model"&&sourceModel&&destinationModel){
      explanation.textContent="The new chat uses a different model ("+
        destinationModel+") from the original chat ("+sourceModel+
        "). The handoff has been pasted into the composer but was not sent. Review the model and thinking effort before sending it manually.";
    }else if(reason==="effort"){
      explanation.textContent="The original thinking effort could not be restored and verified. The handoff has been pasted into the composer but was not sent. Check the model and thinking effort before sending it manually.";
    }else{
      explanation.textContent="The new chat's model could not be verified against the original. The handoff has been pasted into the composer but was not sent. Check the model and thinking effort before sending it manually.";
    }
    const action=document.createElement("button");
    action.type="button";
    action.textContent="Understood";
    const close=()=>dialog.close();
    action.addEventListener("click",close);
    dialog.addEventListener("close",()=>dialog.remove(),{once:true});
    dialog.append(heading,explanation,action);
    document.body.append(dialog);
    dialog.showModal();
    action.focus();
  }
  globalThis.GPTTweaksHandoffModelNotice=Object.freeze({show});
})();