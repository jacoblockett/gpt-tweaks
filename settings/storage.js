;(() => {
	"use strict"

	// Browser extension settings persist in this Brave/Chromium profile.
	// The standalone website preview keeps its original local/session storage behavior.
	const extension = !!(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local)
	const values = Object.create(null)
	const ready = extension
		? chrome.storage.local.get(null).then(saved => Object.assign(values, saved))
		: Promise.resolve()

	function storageError(error) {
		console.error("[GPT Tweaks] Unable to save a setting:", error)
	}

	const preferences = extension
		? {
				getItem(key) {
					return Object.hasOwn(values, key) ? String(values[key]) : null
				},
				setItem(key, value) {
					const saved = String(value)
					values[key] = saved
					void chrome.storage.local.set({ [key]: saved }).catch(storageError)
				},
				removeItem(key) {
					delete values[key]
					void chrome.storage.local.remove(key).catch(storageError)
				}
			}
		: window.localStorage

	// Extension options pages are trusted contexts. The service worker restricts
	// chrome.storage.local access before future content scripts are introduced.
	// The website preview intentionally does not persist its token across sessions.
	const credentials = extension ? preferences : window.sessionStorage

	globalThis.GPTTweaksStorage = { ready, preferences, credentials }
})()
