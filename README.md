# GPT Tweaks

Personal desktop Brave/Chromium extension. This first integration milestone provides the approved settings interface and persistent configuration only. It does **not** yet inject features into ChatGPT.

## Install

1. Clone or download this repository and keep the unpacked folder.
2. Open \`brave://extensions\` (or \`chrome://extensions\`) and enable **Developer mode**.
3. Click **Load unpacked** and select the **repository root**, containing \`manifest.json\`.
4. Click the GPT Tweaks extension icon from the browser toolbar or extensions menu. The full settings page opens in a tab.

After pulling an update, click **Reload** on the extension card. Preferences are stored in this browser profile and survive extension reloads and browser restarts.

## Settings behavior

- Changes save automatically to \`chrome.storage.local\`; there is no Save button.
- Default token target: **512,000**. The context tracker's **Show by default** switch starts **off**. Existing explicit saved preferences take precedence over defaults.
- All switches, the token target and the new-chat destination persist, but their ChatGPT-side behavior is deferred to future integration milestones.
- A GitHub personal access token entered on the extension settings page is stored in \`chrome.storage.local\`. Its visibility is restricted to trusted extension contexts via \`chrome.storage.local.setAccessLevel\`. It is **not encrypted separately** from the browser profile, and will not automatically migrate from the older source-attacher extension. Use a narrowly scoped token with Contents: Read-only and protect your Brave profile.
- No site permissions or ChatGPT content scripts are requested at this stage.
- The \`website/\` files also work as a standalone preview. Outside an extension, regular preferences use webpage \`localStorage\` and its GitHub token uses webpage \`sessionStorage\`. These are separate from extension settings.

## Later milestones

Integrate the source attacher, context tracker, new chat actions, message copy, and session handoff individually. Their existing codebases are retained separately until reviewed and adapted.

## Validation

Load the unpacked extension in Brave, click its toolbar entry, change a setting, close the settings tab, and reopen it. Confirm the choice persists and the two fresh-install defaults are correct. Authenticated ChatGPT behavior is not part of this milestone.
