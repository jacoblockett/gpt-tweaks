"use strict";

// Trusted browser-only bridge for context estimates and nonsecret settings.
// No conversation text or authorization headers may pass through this route.
(() => {
  const prefix = "gpt-tweaks.context.";
  const cachePrefix = prefix + "conversation.";
  const idPattern = /^[a-f0-9-]{36}$/i;
  const options = ["enabled", "default-visible", "menu", "slash", "percent", "tokens", "limit", "target-tokens"];
  const preferenceKeys = options.map(name => prefix + name);
  function authorized(sender) {
    return sender.id === chrome.runtime.id && sender.tab?.id >= 0 &&
      /^https:\/\/chatgpt\.com\//.test(sender.url || "");
  }
  function cleanEntry(entry) {
    return Array.isArray(entry) && entry.length === 3 && typeof entry[0] === "string" &&
      entry[0].length <= 150 && Number.isFinite(entry[1]) && entry[1] >= 0 &&
      (entry[2] === 0 || entry[2] === 1);
  }
  function validCache(cache) {
    return cache && cache.version === 1 &&
      cache.algorithm === "network-text-deduplicated-fullscan-contextfix-finalcount" &&
      Array.isArray(cache.entries) && cache.entries.length <= 100000 &&
      cache.entries.every(cleanEntry) &&
      (cache.observedEntries === undefined || (Array.isArray(cache.observedEntries) &&
        cache.observedEntries.length <= 100000 && cache.observedEntries.every(cleanEntry))) &&
      typeof cache.complete === "boolean" && Number.isFinite(cache.updated);
  }
  async function handle(message) {
    switch (message.type) {
      case "gpt-tweaks:context:preferences": {
        const saved = await chrome.storage.local.get(preferenceKeys);
        const readBool = (key, defaultValue) => saved[prefix + key] === undefined ? defaultValue :
          saved[prefix + key] !== "false";
        const value = Number(saved[prefix + "target-tokens"]);
        return {enabled:readBool("enabled", true), defaultVisible:readBool("default-visible", false),
          menu:readBool("menu", true), slash:readBool("slash", true),
          percent:readBool("percent", true), tokens:readBool("tokens", true),
          limit:readBool("limit", true),
          target:Number.isSafeInteger(value) && value > 0 ? value : 512000};
      }
      case "gpt-tweaks:context:load": {
        if (!idPattern.test(message.id || "")) throw new Error("Invalid conversation ID");
        const key = cachePrefix + message.id.toLowerCase();
        const record = (await chrome.storage.local.get(key))[key];
        return validCache(record) ? record : null;
      }
      case "gpt-tweaks:context:save": {
        if (!idPattern.test(message.id || "") || !validCache(message.cache))
          throw new Error("Invalid numeric context record");
        await chrome.storage.local.set({[cachePrefix + message.id.toLowerCase()]:message.cache});
        return true;
      }
      default: throw new Error("Unknown context tracker request");
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message?.type?.startsWith("gpt-tweaks:context:") ||
        message.type === "gpt-tweaks:context:settings-changed") return;
    if (!authorized(sender)) {respond({ok:false,error:"Unauthorized request"});return;}
    void handle(message).then(data => respond({ok:true,data}), error =>
      respond({ok:false,error:error?.message || String(error)}));
    return true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !preferenceKeys.some(key => key in changes)) return;
    // Only nonsecret preference changes notify content scripts. Inaccessible
    // tabs ignore the message; no tab metadata or GitHub data is forwarded.
    void chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) if (Number.isInteger(tab.id)) {
        void chrome.tabs.sendMessage(tab.id,
          {type:"gpt-tweaks:context:settings-changed"}).catch(() => {});
      }
    }).catch(() => {});
  });
})();