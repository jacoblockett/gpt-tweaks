"use strict"

// Do not expose saved preferences or GitHub credentials to content scripts.
function restrictStorage() {
	void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(error => {
		console.error("[GPT Tweaks] Storage access restriction failed:", error)
	})
}

chrome.runtime.onInstalled.addListener(restrictStorage)
chrome.runtime.onStartup.addListener(restrictStorage)
restrictStorage()

// No popup: clicking the toolbar extension icon opens/focuses the full settings tab.
chrome.action.onClicked.addListener(() => {
	void chrome.runtime.openOptionsPage().catch(error => {
		console.error("[GPT Tweaks] Unable to open settings:", error)
	})
})

// GitHub source utility, loaded only in trusted extension service worker.
importScripts("../utilities/github-source/connection.js","../utilities/github-source/repositories.js","../utilities/github-source/service.js","./github-bridge.js");
