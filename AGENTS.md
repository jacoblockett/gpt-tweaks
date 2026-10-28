# GPT Tweaks — mandatory architectural instructions

**Always inspect existing code and preserve accepted behavior before editing.**

## Ownership
- `chrome/` contains Chrome/Brave extension lifecycle and browser-integration bridges only. Chrome is an execution environment, not an excuse to move feature-specific business logic into it.
- `settings/` owns the entire settings website: its HTML, CSS, client-side state, interactions, and settings-specific UI.
- `utilities/<utility-name>/` owns every utility's domain operations, UI, and orchestration. Keep features isolated from one another.
- `shared/` contains functionality **actually reused** by unrelated areas. Reusable UI belongs in `shared/ui/`. Do not create a shared component merely because future reuse is imaginable.
- Components can contain many functions. **Single responsibility means one cohesive reason to change**, not one function, constant, event handler, or line per file.
- Put UI presentation under its owning feature's `ui/` folder. Only move it into shared UI when reuse is real.

## KISS / YAGNI / DRY
- Prefer a small number of clearly named, cohesive source files and shallow directory structures.
- Avoid registries, adapters, configuration frameworks, wrappers, micro-modules, build tools, and generalized dropdown engines unless an actual requirement justifies them.
- The existing minimal menu registration collection is permitted because multiple utilities share the native plus/slash injection surface; do not expand it into a plugin framework.
- Do not add a custom concat pipeline or `dist/` solely for reorganizing files. Chrome MV3 loads scripts in manifest order; preserve the accepted load order and execution contexts.
- Keep shared dependencies independent of specific utilities. Never expose tokens to ChatGPT or website content scripts.

## Compatibility contract
- Preserve all accepted GitHub Source behavior, plus/slash keyboard injection, repository search and highlighting, input focus, branch and commit selection, virtualized commit pagination, scrollbar interaction, ZIP attachment handoff, and original styling.
- Keep the GitHub App client ID and `gpt-tweaks.github.*` storage keys unchanged. Extension reloads must not wipe authentication/history.
- Preserve MV3 extension identity, permissions, runtime message names and responses, authorized sender validation, and privileged operations.
- A pure restructuring should be demonstrably behavior-preserving. Verify changed source paths, manifest references, service-worker imports, settings asset paths, syntax, menu observers, message routing and key UX paths.

## Workflow
- Work against the actual repository state; make small cohesive changes and verify each.
- Prefer direct, transparent source files with no build step for an unpacked extension. Do not publish a partially validated restructure.
- Do not create, retain, or run test suites, test fixtures, synthetic DOM harnesses, or automated tests unless the user explicitly requests tests for that work. Do not substitute simulated tests for interactive Brave verification.
- Review changes against available real source evidence and user-supplied browser captures. Never claim to have run authenticated, interactive Brave verification unless that occurred.
- Do not redesign the UI or reimplement functional workflows while only restructuring.

## Canonical directories
- `chrome/`: Chrome/Brave extension lifecycle and browser communication bridges.
- `settings/`: the entire independent settings website and its dedicated controllers.
- `utilities/token-estimator/`: Token Estimator estimation, history, UI and menu registration; retain legacy `gpt-tweaks.context.*` storage keys and `ct-v1-*` events for compatibility.
- `utilities/github-source/`: GitHub services, archive attachment and owning UI.
- `shared/ui/menus/`: actually reusable plus/slash menu components.
