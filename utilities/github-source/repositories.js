(() => {
"use strict";
const {PREFIX,MAX_ZIP_BYTES,REPO,ROOT,validateSpec,validBranch,readAuth,api}=globalThis.__gptTweaksGitHubConnection;
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
  if (!Number.isSafeInteger(page)||page<1) throw Error("Invalid commit page.");
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
  if(!auth?.access_token)return {repositories:[]};
  const repos=new Map();
  // A GitHub App user access token can list the repositories available
  // to both the user and the app without traversing installations.
  for(let page=1;page<=100;page++){
    const result=await api(ROOT+"/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&per_page=100&page="+page,auth.access_token);
    if(!Array.isArray(result))throw Error("Unexpected GitHub repository list response.");
    for(const entry of result){
      if(entry.full_name)repos.set(entry.full_name.toLowerCase(),{repo:entry.full_name,private:!!entry.private});
    }
    if(result.length<100)break;
  }
  return {repositories:[...repos.values()].sort((a,b)=>a.repo.localeCompare(b.repo))};
}

globalThis.__gptTweaksGitHubRepositories={repoMeta,branches,commits,resolve,zip,history,storeHistory,listOwnRepos};
})();