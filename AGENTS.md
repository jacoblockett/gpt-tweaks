# GPT Tweaks: repository development instructions

**Inspect existing source and preserve accepted behavior before editing. Reuse implemented functionality and native ChatGPT icons and styles instead of inventing replacements.**

## Structure and ownership

- `chrome/`: Chromium extension lifecycle and privileged service-worker bridges.
- `settings/`: the settings page, its visual design, local preferences, and GitHub-account UI.
- `utilities/header-menu/`: the GPT Tweaks button beside Share and its alphabetical dropdown.
- `utilities/github-source/`: GitHub authorization, repository discovery/history, ZIP attachment and modal.
- `utilities/enhanced-copy/`: Copy Chat, history retrieval and clipboard feedback.
- `utilities/session-handoff/`: generation, model/effort continuity, intake and recovery.
- `utilities/token-estimator/`: automatic header token counter, streaming/history reconciliation and numeric cache.
- `utilities/message-timestamps/`: native action-row timestamps from verified user submission metadata and successfully rendered assistant completions. Historical assistant completion times are intentionally unknown unless captured live.
- `utilities/notifications/`: background-only response alerts triggered by successfully completed and rendered assistant messages; sound playback is owned by the Chromium offscreen document.
- `utilities/new-chat/`: native New chat middle-click shortcuts and project-aware new tab/window creation.
- `shared/conversation/`: common conversation history/content extraction.
- `shared/ui/feature-registry.js`: the small shared icon/action registry and composer selector used by the header.
- `shared/ui/select.*`: dropdown control reused by GitHub and Settings.

**The extension no longer inserts UI into ChatGPT's attachment (+), slash-command or Chat Actions menus.** Never restore those legacy menu injection mechanisms without explicit authorization. The GPT Tweaks header dropdown contains Attach Source Code, Copy Chat and Session Handoff, alphabetically.

## Coding principles and compatibility

- KISS, YAGNI, DRY, single responsibility. Prefer cohesive files, direct dependencies, minimal abstractions and no build step.
- Do not replace working algorithms, approved icons or exact browser selectors without actual evidence. Do not guess at native ChatGPT DOM behavior.
- Preserve header dropdown mouse/keyboard focus behavior: no initially selected item, one shared hover/arrow selection and Escape dismissal.
- Preserve project-aware New chat middle-click interception for both sidebar states, and the Open in destination preference.
- Preserve GitHub App client ID, account installation workflow, private repository access, repository history, branch/commit selection, and archive handoff.
- Keep browser storage restricted to trusted contexts, authorization checks in service workers and numeric history summaries separate from page text.
- Preserve MV3 permissions and execution contexts/load order, active runtime message names, enabled feature settings and authorized sender validation.

## Persistent data

- Keep `gpt-tweaks.github.*` authorization and history keys intact.
- Keep the active feature enable keys, including `gpt-tweaks.notifications.enabled`, `gpt-tweaks.new-chat.destination`, token estimator cache records `gpt-tweaks.context.conversation.*`, and session handoff state.
- Keep token algorithm identifiers, cache formats and active `ct-v1-*` events unchanged unless migration is explicitly requested.
- Obsolete settings keys from deleted plus/slash menus, targets and visibility toggles may remain in users' storage. Do not clear stored preferences or caches as part of source cleanup.

## Workflow

- Audit actual references before deleting or moving code. Update callers and manifest/service-worker imports together.
- Make scoped changes; review syntax, source paths, data contracts and the supplied ChatGPT HTML captures.
- Do not claim authenticated live Brave testing when only source inspection was performed.
- Do not create or run new test suites or synthetic DOM harnesses unless the user requests them.
