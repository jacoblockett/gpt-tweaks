(() => {
"use strict";
const {PREFIX,APP_INSTALL_URL,APP_MANAGE_URL,authStart,authPoll,authStatus,disconnect,installationStatus}=globalThis.__gptTweaksGitHubConnection;
const {repoMeta,branches,commits,zip,history,storeHistory,listOwnRepos}=globalThis.__gptTweaksGitHubRepositories;
async function dispatch(message) {
  switch(message.kind){
    case "gpt-github-feature-status":{
      if(!["menu","slash"].includes(message.method))throw Error("Unknown attachment method.");
      const data=await chrome.storage.local.get(["gpt-tweaks.archives.enabled","gpt-tweaks.archives."+message.method]);
      return {enabled:data["gpt-tweaks.archives.enabled"]!=="false"&&data["gpt-tweaks.archives."+message.method]!=="false"};
    }
    case "gpt-github-meta":return repoMeta(message.repo);
    case "gpt-github-branches":return branches(message);
    case "gpt-github-commits":return commits(message);
    case "gpt-github-zip":return zip(message);
    case "gpt-github-history":return history();
    case "gpt-github-history-add":return storeHistory(message.repo);
    case "gpt-github-history-remove":{
      const current=await history();
      const list=current.filter(x=>x.toLowerCase()!==String(message.repo||"").toLowerCase());
      await chrome.storage.local.set({[PREFIX+"repository-history"]:JSON.stringify(list)});
      return list;
    }
    case "gpt-github-history-clear":
      await chrome.storage.local.remove(PREFIX+"repository-history");return [];
    case "gpt-github-repositories":return listOwnRepos();
    case "gpt-github-install-status":return installationStatus();
    case "gpt-github-install-open":
      await chrome.tabs.create({url:APP_INSTALL_URL,active:true});return true;
    case "gpt-github-install-manage":
      await chrome.tabs.create({url:APP_MANAGE_URL,active:true});return true;
    case "gpt-github-auth-status":return authStatus();
    case "gpt-github-auth-start":return authStart();
    case "gpt-github-auth-poll":return authPoll();
    case "gpt-github-auth-open":await chrome.tabs.create({url:"https://github.com/login/device",active:true});return true;
    case "gpt-github-auth-disconnect":return disconnect();
    default:throw Error("Unknown GitHub request.");
  }
}

globalThis.__gptTweaksGitHubDispatch=dispatch;
})();