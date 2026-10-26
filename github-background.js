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
async function repoMeta(name) {
  const {repo} = validateSpec({repo:name});
  const auth = await readAuth();
  let data;
  try {
    data=await api(ROOT + "/repos/" + repo, auth?.access_token,
      "Repository not found or inaccessible.");
  } catch(error) {
    if(error.code==="NOT_FOUND")error.code="REPOSITORY_UNAVAILABLE";
    throw error;
  }
  if (data.full_name?.toLowerCase() !== repo.toLowerCase()) throw Error("Repository redirects to a different name. Enter its canonical owner/repo.");
  return {repo:data.full_name,defaultBranch:data.default_branch || "",private:!!data.private};
}
async function branches(input) {
  const {repo}=validateSpec(input);
  const page = input.page;
  if (!Number.isSafeInteger(page) || page<1 || page>100) throw Error("Invalid branch page.");
  const meta = await repoMeta(repo);
  const auth = await readAuth();
  const list = await api(ROOT+"/repos/"+meta.repo+"/branches?per_page=100&page="+page,auth?.access_token);
  return {...meta, branches:list.map(x=>x.name).filter(Boolean),hasMore:list.length===100};
}
async function commits(input) {
  const {repo,branch}=validateSpec(input);
  if (!branch) throw Error("Select a branch.");
  const page=input.page;
  if (!Number.isSafeInteger(page)||page<1||page>100) throw Error("Invalid commit page.");
  const auth=await readAuth();
  const root=ROOT+"/repos/"+repo;
  let tip=input.tip || "";
  if (page===1) {
    const detail=await api(root+"/branches/"+encodeURIComponent(branch),auth?.access_token);
    tip=detail.commit?.sha || "";
  }
  if (!/^[a-f0-9]{40}$/i.test(tip)) throw Error("Invalid branch tip.");
  const list=await api(root+"/commits?sha="+tip+"&per_page=100&page="+page,auth?.access_token);
  return {tip,commits:list.map(x=>({
    sha:x.sha,date:(x.commit?.committer?.date||x.commit?.author?.date||"").slice(0,10),
    message:String(x.commit?.message||"").split("\n")[0].slice(0,100)
  })),hasMore:list.length===100};
}
async function resolve(input) {
  const {repo,branch,commit}=validateSpec(input);
  const meta=await repoMeta(repo);
  const auth=await readAuth();
  const base=ROOT+"/repos/"+meta.repo;
  const actualBranch=branch||meta.defaultBranch;
  if (!actualBranch) throw Error("Repository has no default branch.");
  if (!validBranch(actualBranch)) throw Error("Invalid default branch.");
  const detail=await api(base+"/branches/"+encodeURIComponent(actualBranch),auth?.access_token,"Branch not found.");
  const tip=detail.commit?.sha || "";
  if (!/^[a-f0-9]{40}$/i.test(tip)) throw Error("GitHub returned an invalid branch tip.");
  let selected=tip;
  if (commit) {
    const item=await api(base+"/commits/"+commit,auth?.access_token,"Commit not found.");
    selected=item.sha;
    if (!/^[a-f0-9]{40}$/i.test(selected)) throw Error("Invalid commit SHA.");
    const comparison=await api(base+"/compare/"+selected+"..."+tip,auth?.access_token);
    if (!["ahead","identical"].includes(comparison.status)) throw Error("Commit is not an ancestor of the selected branch.");
  }
  return {...meta,branch:actualBranch,sha:selected};
}
function bytesToBase64(bytes) {
  let text="";
  for (let index=0;index<bytes.length;index+=24576) {
    let part="";
    for (const n of bytes.subarray(index,index+24576)) part+=String.fromCharCode(n);
    text+=btoa(part);
  }
  return text;
}
async function zip(input) {
  const resolved=await resolve(input);
  const auth=await readAuth();
  const url=ROOT+"/repos/"+resolved.repo+"/zipball/"+resolved.sha;
  const headers={"Accept":"application/vnd.github+json"};
  if (auth?.access_token) headers.Authorization="Bearer "+auth.access_token;
  const response=await fetch(url,{headers,credentials:"omit",redirect:"follow",cache:"no-store"});
  if (!response.ok || !response.body) throw Error("ZIP download failed (HTTP "+response.status+").");
  if (Number(response.headers.get("content-length"))>MAX_ZIP_BYTES) throw Error("Repository ZIP is larger than 16 MiB.");
  const reader=response.body.getReader(),chunks=[];
  let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>MAX_ZIP_BYTES) { await reader.cancel();throw Error("Repository ZIP is larger than 16 MiB."); }
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for (const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  if (size<4||bytes[0]!==0x50||bytes[1]!==0x4b||![3,5].includes(bytes[2])||![4,6].includes(bytes[3]))
    throw Error("GitHub returned an invalid ZIP archive.");
  return {filename:resolved.repo.split("/")[1]+"-"+resolved.sha.slice(0,12)+".zip",
    base64:bytesToBase64(bytes),sha:resolved.sha,repo:resolved.repo};
}
async function history() {
  const data=await chrome.storage.local.get(PREFIX+"repository-history");
  try {
    const value=JSON.parse(data[PREFIX+"repository-history"]||"[]");
    return Array.isArray(value)?value.filter(x=>typeof x==="string"&&REPO.test(x)).slice(0,100):[];
  } catch {return [];}
}
async function storeHistory(repo) {
  validateSpec({repo});
  const old=await history();
  const list=[repo,...old.filter(x=>x.toLowerCase()!==repo.toLowerCase())].slice(0,100);
  await chrome.storage.local.set({[PREFIX+"repository-history"]:JSON.stringify(list)});
  return list;
}
async function listOwnRepos() {
  const auth=await readAuth();
  if (!auth?.access_token) return [];
  const rows=[];
  for(let page=1;page<=30;page++){
    const current=await api(ROOT+"/user/repos?per_page=100&page="+page+"&affiliation=owner,collaborator,organization_member",auth.access_token);
    if(!Array.isArray(current))throw Error("Unexpected GitHub repository response.");
    for(const x of current)if(x.full_name)rows.push({repo:x.full_name,private:!!x.private});
    if(current.length<100)break;
  }
  return rows;
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
async function authStatus() {
  const auth=await readAuth();
  const data=await chrome.storage.local.get(PREFIX+"account");
  return {connected:!!auth?.access_token,account:auth?.access_token?data[PREFIX+"account"]||"": "",
    supported:!!GITHUB_APP_CLIENT_ID};
}
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
    case "gpt-github-auth-status":return authStatus();
    case "gpt-github-auth-start":return authStart();
    case "gpt-github-auth-poll":return authPoll();
    case "gpt-github-auth-open":await chrome.tabs.create({url:"https://github.com/login/device",active:true});return true;
    case "gpt-github-auth-disconnect":return disconnect();
    default:throw Error("Unknown GitHub request.");
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!message?.kind?.startsWith("gpt-github-")) return;
  const source=sender.url||"";
  if(sender.id!==chrome.runtime.id ||
    !(source.startsWith("https://chatgpt.com/")||source.startsWith(chrome.runtime.getURL("website/")))) {
    respond({ok:false,error:"Unauthorized request."});return;
  }
  Promise.resolve().then(()=>dispatch(message)).then(data=>respond({ok:true,data}),
    error=>respond({ok:false,error:error?.message||String(error),code:error?.code||""}));
  return true;
});
