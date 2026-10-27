(() => {
"use strict";
globalThis.__gptTweaksPlusMenu=(config,helpers)=>{
const {visible,setMenuIcon,onPlusRowMounted}=helpers;
const COMMAND_TITLE=config.title,ARCHIVE_DESCRIPTION=config.description;
const isEnabled=config.isEnabled,launch=config.activate;
  function styleInjectedMenuRow(button,kind="slash"){
    button.removeAttribute("aria-current");
    button.removeAttribute("aria-selected");
    button.classList.remove("bg-primary-ghost-hover","opacity-100");
    button.classList.add("menu-row-opacity");
    // Plus-menu selection and hover are owned by the complete menu controller.
    // Slash commands retain their existing per-row pointer appearance.
    if(kind==="plus"||kind==="controlled")return;
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

  // Menu sections remain React-owned. Decorations and injected buttons must not
  // impersonate React's data-list-navigation-item records.
  function removeMenuGroup(kind){
    for(const item of document.querySelectorAll('[data-gtg-menu-header="'+kind+'"],[data-gtg-menu-divider="'+kind+'"]'))
      item.remove();
  }
  function mountMenuGroup(section,button,kind){
    if(!section)return;
    const oldDivider=section.querySelector('[data-gtg-menu-divider="'+kind+'"]');
    if(oldDivider){
      // Alphabetize GPT Tweaks rows regardless of script and async load order.
      const following=[...section.querySelectorAll(':scope > [data-gtg-menu-title]')]
        .find(row=>row.dataset.gtgMenuTitle.localeCompare(button.dataset.gtgMenuTitle,undefined,{sensitivity:"base"})>0);
      (following||oldDivider).before(button);
      return;
    }
    removeMenuGroup(kind);
    const heading=document.createElement("div");
    heading.className="gtg-menu-heading";
    heading.dataset.gtgMenuHeader=kind;
    heading.textContent="GPT Tweaks";
    heading.setAttribute("aria-hidden","true");
    const divider=document.createElement("div");
    divider.className="gtg-menu-divider";
    divider.dataset.gtgMenuDivider=kind;
    divider.setAttribute("role","separator");
    section.prepend(heading,button,divider);
  }
  function createMenuOption(reference){
    const element=reference.closest('button[data-list-navigation-item="true"]');
    const section=element?.closest('[data-mention-section-items="true"]');
    if(!section||!visible(element))return;
    if([...section.querySelectorAll('[data-gtg-menu-option="true"]')].some(row=>row.dataset.gtgUtilityId===config.id))return;

    // Clone the native row's entire layout, not just its outer button.
    // The captured ChatGPT menu uses these semantic data attributes for
    // the icon, label, description and menu-section parent.
    const button=element.cloneNode(true);
    for(const attr of ["id","aria-current","aria-selected","aria-haspopup","aria-expanded","data-state"])
      button.removeAttribute(attr);
    button.dataset.gtgMenuOption="true";
    button.dataset.gtgUtilityId=config.id;
    button.dataset.gtgMenuTitle=COMMAND_TITLE;
    // React uses this DOM attribute for scroll indexes based on its own data array.
    button.removeAttribute("data-list-navigation-item");
    button.type="button";
    const content=button.querySelector('[data-menu-row-content="true"]');
    const label=content?.querySelector(':scope > span:last-child > span > span:first-child');
    const detail=content?.querySelector(':scope > span:last-child > span > span:last-child');
    const iconSlot=content?.querySelector('[data-leading-icon-slot="menu"]');
    if(!label||!detail||!iconSlot)return;
    label.textContent=COMMAND_TITLE;
    detail.textContent=ARCHIVE_DESCRIPTION;

    setMenuIcon(iconSlot);
    styleInjectedMenuRow(button,"plus");
    button.addEventListener("mousedown",event=>event.preventDefault());
    button.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      // Unlike a React-owned row, this injected button cannot close the
      // native menu through its internal onSelect callback.
      const trigger=document.querySelector('button[data-composer-navigation-target="add-context"][aria-expanded="true"]');
      trigger?.click();
      launch("menu");
    });
    mountMenuGroup(section,button,"menu");
    onPlusRowMounted();
  }
  async function scanMenu(){
    const labels=document.querySelectorAll('[data-mention-section-items="true"] > button[data-list-navigation-item="true"]');
    const native=[...labels].find(el=>visible(el)&&!el.dataset.gtgMenuOption&&
      (el.innerText||"").trim().toLowerCase().startsWith("add from library"));
    if(!native)return;
    try{
      const enabled=await isEnabled("menu");
      if(!native.isConnected)return;
      const existing=[...native.parentElement.querySelectorAll('[data-gtg-menu-option="true"]')].find(row=>row.dataset.gtgUtilityId===config.id);
      if(enabled)createMenuOption(native);
      else {
        existing?.remove();
        if(!native.parentElement.querySelector('[data-gtg-menu-option="true"]'))
          removeMenuGroup("menu");
      }
    }catch{}
  }

return {scanMenu,styleInjectedMenuRow,mountMenuGroup,removeMenuGroup};
};
})();