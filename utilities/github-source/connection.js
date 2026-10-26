(() => {
"use strict";
// Set to the public Client ID of a GitHub App with device flow enabled and
// Contents: Read-only repository access. Never place a client secret here.
const GITHUB_APP_CLIENT_ID = "Iv23lirYD1P4hjuWYkyT";
const PREFIX = "gpt-tweaks.github.";
const MAX_ZIP_BYTES = 16 * 1024 * 1024;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const SHA = /^[0-9a-f]{7,40}$/i;
const ROOT = "https://api.github.com";

function validBranch(value) {
  return typeof value === "string" && value.length <= 255 &&
    !/[\x00-\x20\x7f~^:?*\[\\]/.test(value) && !value.includes("..") &&
    !value.includes("@{") && value !== "@" &&
    value.split("/").every(part => part && !part.startsWith(".") && !part.endsWith(".lock") && !part.endsWith("."));
}
function validateSpec(input) {
  const {repo, branch = "", commit = ""} = input || {};
  if (!REPO.test(repo || "") || repo.endsWith(".git")) throw Error("Enter a repository as owner/repo.");
  if (branch && !validBranch(branch)) throw Error("Invalid Git branch.");
  if (commit && !SHA.test(commit)) throw Error("Invalid Git commit.");
  return {repo, branch, commit};
}
async function readAuth() {
  const data = await chrome.storage.local.get(PREFIX + "auth");
  const auth=data[PREFIX + "auth"] || null;
  if(!auth?.access_token || !auth.expires || Date.now()<auth.expires-60000) return auth;
  if(!auth.refresh_token || (auth.refreshExpires && Date.now()>auth.refreshExpires))return null;
  try {
    const response=await tokenPost("oauth/access_token",{
      client_id:GITHUB_APP_CLIENT_ID,
      grant_type:"refresh_token",
      refresh_token:auth.refresh_token
    });
    if(!response.access_token) return null;
    const renewed={
      access_token:response.access_token,
      refresh_token:response.refresh_token || auth.refresh_token,
      expires:response.expires_in?Date.now()+response.expires_in*1000:0,
      refreshExpires:response.refresh_token_expires_in?Date.now()+response.refresh_token_expires_in*1000:auth.refreshExpires
    };
    await chrome.storage.local.set({[PREFIX+"auth"]:renewed});
    return renewed;
  } catch { return null; }
}
async function api(url, token = "", missing = "GitHub repository not found or not accessible.") {
  const headers = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(url, {credentials:"omit",cache:"no-store",headers});
  if (!response.ok) {
    let message = "";
    try { message = (await response.json()).message || ""; } catch {}
    if (response.status === 404) {
      const error=new Error(missing);
      error.code="NOT_FOUND";
      throw error;
    }
    if (response.status === 401) throw Error("GitHub authorization expired. Sign in again.");
    if (response.status === 403) throw Error("GitHub access denied or API rate limit reached: " + (message || "HTTP 403"));
    throw Error("GitHub request failed (HTTP " + response.status + "): " + (message || "unknown error"));
  }
  return response.json();
}

async function tokenPost(endpoint,params) {
  const response=await fetch("https://github.com/login/"+endpoint,{
    method:"POST",credentials:"omit",cache:"no-store",
    headers:{"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams(params)
  });
  if(!response.ok)throw Error("GitHub device authorization failed (HTTP "+response.status+").");
  return response.json();
}
async function authStart() {
  if(!GITHUB_APP_CLIENT_ID) throw Error("GitHub App client ID has not been configured.");
  const result=await tokenPost("device/code",{client_id:GITHUB_APP_CLIENT_ID});
  if(!result.device_code||!result.user_code)throw Error("GitHub did not issue an authorization code.");
  // Device code remains in trusted extension session storage, not the ChatGPT DOM.
  await chrome.storage.session.set({[PREFIX+"pending"]:{
    device_code:result.device_code,expires:Date.now()+result.expires_in*1000,
    interval:Math.max(result.interval||5,5)
  }});
  return {user_code:result.user_code,verification_uri:result.verification_uri,
    expires_in:result.expires_in,interval:Math.max(result.interval||5,5)};
}
async function authPoll() {
  const data=await chrome.storage.session.get(PREFIX+"pending");
  const pending=data[PREFIX+"pending"];
  if(!pending||Date.now()>pending.expires)throw Error("GitHub authorization code expired.");
  const response=await tokenPost("oauth/access_token",{client_id:GITHUB_APP_CLIENT_ID,
    device_code:pending.device_code,grant_type:"urn:ietf:params:oauth:grant-type:device_code"});
  if(response.error==="authorization_pending")return {pending:true,interval:pending.interval};
  if(response.error==="slow_down")return {pending:true,interval:pending.interval+5};
  if(response.error)throw Error("GitHub authorization: "+response.error);
  if(!response.access_token)throw Error("GitHub returned no access token.");
  const account=await api(ROOT+"/user",response.access_token);
  if(!account.login)throw Error("Could not identify the authorized GitHub account.");
  const auth={access_token:response.access_token,refresh_token:response.refresh_token||"",
    expires:response.expires_in?Date.now()+response.expires_in*1000:0,
    refreshExpires:response.refresh_token_expires_in?Date.now()+response.refresh_token_expires_in*1000:0};
  await chrome.storage.local.set({[PREFIX+"auth"]:auth,[PREFIX+"account"]:account.login});
  await chrome.storage.session.remove(PREFIX+"pending");
  return {connected:true,account:account.login};
}
async function disconnect() {
  await chrome.storage.local.remove([PREFIX+"auth",PREFIX+"account"]);
  await chrome.storage.session.remove(PREFIX+"pending");
  return {connected:false};
}
const APP_INSTALL_URL="https://github.com/apps/gpt-tweaks/installations/new";
const APP_MANAGE_URL="https://github.com/settings/installations";
async function installationStatus() {
  const auth=await readAuth();
  if(!auth?.access_token)return {connected:false,installationsCount:0,accounts:[]};
  const accounts=[];
  for(let page=1;page<=30;page++){
    const data=await api(ROOT+"/user/installations?per_page=100&page="+page,auth.access_token);
    if(!Array.isArray(data.installations))throw Error("Unexpected GitHub installations response.");
    for(const installation of data.installations) {
      accounts.push({name:installation.account?.login||"",selection:installation.repository_selection||""});
    }
    if(data.installations.length<100)break;
  }
  return {connected:true,installationsCount:accounts.length,accounts};
}
async function authStatus() {
  const auth=await readAuth();
  const data=await chrome.storage.local.get(PREFIX+"account");
  return {connected:!!auth?.access_token,account:auth?.access_token?data[PREFIX+"account"]||"": "",
    supported:!!GITHUB_APP_CLIENT_ID};
}

globalThis.__gptTweaksGitHubConnection={GITHUB_APP_CLIENT_ID,PREFIX,MAX_ZIP_BYTES,REPO,SHA,ROOT,validBranch,validateSpec,readAuth,api,authStart,authPoll,disconnect,installationStatus,authStatus,APP_INSTALL_URL,APP_MANAGE_URL};
})();