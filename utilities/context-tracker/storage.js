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
    getVisibility:id => send("get-visibility", {id}),
    setVisibility:(id, visible) => send("set-visibility", {id, visible}),
    load:id => send("load", {id}),
    save:(id, cache) => send("save", {id, cache})
  });
})();