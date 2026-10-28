(() => {
  "use strict";
  if(globalThis.GPTTweaksHandoffToast)return;

  function show() {
    if(!document.body)return ()=>{};
    document.getElementById("gtg-handoff-toast")?.remove();

    const toast=document.createElement("aside");
    toast.id="gtg-handoff-toast";
    toast.setAttribute("role","status");
    toast.setAttribute("aria-live","polite");

    const content=document.createElement("div");
    content.className="gtg-handoff-toast-content";

    const title=document.createElement("strong");
    title.textContent="Session handoff in progress";

    const description=document.createElement("p");
    description.textContent="Your conversation is being summarized. A new chat will open automatically. Try not to touch anything.";

    const dismiss=document.createElement("button");
    dismiss.type="button";
    dismiss.className="gtg-handoff-toast-dismiss";
    dismiss.setAttribute("aria-label","Dismiss notification");
    dismiss.textContent="×";

    const close=()=>toast.remove();
    dismiss.addEventListener("click",close);
    content.append(title,description);
    toast.append(content,dismiss);
    document.body.append(toast);
    return close;
  }

  globalThis.GPTTweaksHandoffToast=Object.freeze({show});
})();
