/* Untrusted ChatGPT content scripts have no direct access to extension storage. */
(() => {
  "use strict";
  const send = async (type, fields = {}) => {
    const result = await chrome.runtime.sendMessage({type:`gpt-tweaks:context:${type}`, ...fields});
    if (!result?.ok) throw new Error(result?.error || "Context tracker background unavailable");
    return result.data;
  };
  globalThis.GPTTweaksContextStorage = Object.freeze({
    preferences:() => send("preferences"),
    load:id => send("load", {id}),
    save:(id, cache) => send("save", {id, cache}),
    setTarget:target => send("set-target", {target})
  });
})();