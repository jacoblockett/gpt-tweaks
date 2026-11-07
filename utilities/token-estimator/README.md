# Token Estimator

GPT Tweaks displays an estimated conversation token count in the center of ChatGPT's titlebar. The display is automatic when **Token Estimator** is enabled in extension settings. An empty new chat starts at **0 tokens**; existing chats show the ChatGPT-style spinner and **Loading token estimate** while initial history loads, then show **N tokens**. There is no progress bar, percentage, target, or per-conversation manual visibility option.

## Runtime

- `estimator-core.js` implements the retained numeric token/message accounting algorithm in both execution worlds.
- `history-bridge.js` executes in `MAIN` at `document_start`, passively summarizing ChatGPT history responses and generation streams. DOM events carry numeric summaries and message IDs, not full message text or request headers.
- `storage.js` proxies validated cache records and the `enabled` preference through `chrome/token-estimator-bridge.js`. Extension storage remains restricted to trusted contexts.
- `index.js` handles history pagination, estimates, stream reconciliation, caching, route transitions and the feature enable switch.
- `ui/indicator.js` displays the header estimate and native-style spinner. `ui/styles.css` centers the status.

Preserve `gpt-tweaks.context.enabled`, `gpt-tweaks.context.conversation.*` cached records, cache version/algorithm identifiers, and active `ct-v1-*` events. Obsolete visibility/target keys may remain stored on installed browsers but are not used or cleared. The estimate is not a measurement of ChatGPT's actual model context limit.

## Verification

Source checks can confirm syntax, dependencies and manifest order. Authenticated history retrieval, real streaming estimates, responsive titlebar positioning and loading behavior must still be checked in Brave.
