(() => {
  "use strict";
  const COMMAND="/attach-github-source";
  const COMMAND_TITLE="Attach GitHub Source";
  const ARCHIVE_DESCRIPTION="Attach a GitHub repository source code.";
  function githubIcon(size){
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("width",String(size));
    svg.setAttribute("height",String(size));
    svg.setAttribute("viewBox","0 0 24 24");
    svg.setAttribute("fill","none");
    svg.setAttribute("stroke","currentColor");
    svg.setAttribute("stroke-width","1.8");
    svg.setAttribute("stroke-linecap","round");
    svg.setAttribute("stroke-linejoin","round");
    svg.setAttribute("aria-hidden","true");
    const shapes=[
      "M9 19c-4.3 1.4-4.3-2.5-6-3",
      "M15 22v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 19 4.77 5.07 5.07 0 0 0 18.91 1S17.73.65 15 2.48a13.38 13.38 0 0 0-7 0C5.27.65 4.09 1 4.09 1A5.07 5.07 0 0 0 4 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 8 18.13V22"
    ];
    for(const d of shapes){
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",d);
      svg.append(path);
    }
    return svg;
  }

  const {launch,isEnabled}=globalThis.__gptTweaksGitHubSourceUI;
  globalThis.__gptTweaksMenus.register({
    id:"github-source",
    command:COMMAND,
    title:COMMAND_TITLE,
    description:ARCHIVE_DESCRIPTION,
    icon:githubIcon,
    isEnabled,
    isOpen:()=>Boolean(modal),
    activate:launch
  });

})();
