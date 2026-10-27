# Context Tracker

First-stage port of the original standalone ChatGPT Context Tracker 1.0 into GPT Tweaks.

- `tracker-core.js` estimates tokens and classifies/counts messages in **both** execution worlds. The estimator and reconciliation semantics are carried over unchanged.
- `history-bridge.js` runs at `document_start` in `MAIN` to passively summarize ChatGPT history and generation SSE. Its DOM events contain numeric estimates and message IDs, not message text or request headers.
- `storage.js` is an `ISOLATED`-world proxy. `chrome/context-bridge.js` validates the sender, exposes only context preferences and numeric per-conversation cache records, and keeps browser storage restricted to trusted contexts.
- `index.js` owns state, pagination, streaming reconciliation and numeric caching. `ui/indicator.js` owns the native-composer indicator, theme alignment and React remount lifecycle. `ui/styles.css` owns the small page-level footer transparency adjustment.

Settings are controlled by `settings/index.html`: enable Context tracker and **Show by default** to see the indicator in saved chats. The personal target defaults to **512,000 tokens**, independent of actual server context limits. The indicator centers the optional token usage and percentage label over the progress bar, with the progress line masked behind the text. The target is read-only in the composer and can be changed only on the trusted extension settings page. The message-count algorithm is retained in the core but is not displayed or configured by this utility. The original standalone extension's cached estimates are not migrated across extension IDs; they are rehydrated from ChatGPT history.

**Integrated:** The Context Tracker registers `Status` in ChatGPT's `+` and `/status` command menus through the same shared menu adapter used by GitHub Source. The command toggles the indicator for the current conversation without modifying Show by default; its two visibility entry points honor their settings. The Target Exceeded pill has been removed entirely. Threshold colors remain on the bar and counter.

Run `node tests/context-tracker.test.js` for dependency-free, simulated estimator/history/stream/storage regression tests. These **do not** prove compatibility with the live authenticated ChatGPT history endpoint, or native composer geometry in a signed-in Brave browser. Visual and authenticated behavior need user validation.