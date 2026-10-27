;(async () => {
	"use strict"
	const { ready, preferences: preferenceStore } = globalThis.GPTTweaksStorage
	await ready
	const $ = id => document.getElementById(id)
	const enabled = $("archive-enabled")
	const menu = $("method-menu")
	const slash = $("method-slash")
	const methods = $("attachment-methods")
	const feedback = $("method-feedback")
	const preferences = {
		enabled: preferenceStore.getItem("gpt-tweaks.archives.enabled") !== "false",
		menu: preferenceStore.getItem("gpt-tweaks.archives.menu") !== "false",
		slash: preferenceStore.getItem("gpt-tweaks.archives.slash") !== "false"
	}
	enabled.checked = preferences.enabled
	menu.checked = preferences.menu
	slash.checked = preferences.slash
	if (!menu.checked && !slash.checked) menu.checked = true

	function syncFeature() {
		methods.classList.toggle("inactive", !enabled.checked)
		menu.disabled = !enabled.checked
		slash.disabled = !enabled.checked
		preferenceStore.setItem("gpt-tweaks.archives.enabled", enabled.checked)
		preferenceStore.setItem("gpt-tweaks.archives.menu", menu.checked)
		preferenceStore.setItem("gpt-tweaks.archives.slash", slash.checked)
	}
	enabled.addEventListener("change", () => {
		feedback.textContent = ""
		syncFeature()
	})
	;[menu, slash].forEach(control =>
		control.addEventListener("change", () => {
			if (!menu.checked && !slash.checked) {
				control.checked = true
				feedback.textContent = "Keep at least one attachment method enabled, or turn off the feature."
			} else feedback.textContent = ""
			syncFeature()
		})
	)
	syncFeature()

	await globalThis.__gptTweaksInitGitHubSettings($,preferenceStore);
	// Conversation context-tracker preferences
	const contextKeys = {
		enabled: "gpt-tweaks.context.enabled",
		defaultVisible: "gpt-tweaks.context.default-visible",
		menu: "gpt-tweaks.context.menu",
		slash: "gpt-tweaks.context.slash",
		percent: "gpt-tweaks.context.percent",
		tokens: "gpt-tweaks.context.tokens",
		limit: "gpt-tweaks.context.limit"
	}
	const contextElements = {
		enabled: $("context-enabled"),
		defaultVisible: $("context-default-visible"),
		menu: $("context-menu"),
		slash: $("context-slash"),
		percent: $("context-show-percent"),
		tokens: $("context-show-tokens"),
		limit: $("context-show-limit")
	}
	const contextControls = $("context-controls")
	const contextFeedback = $("context-feedback")
	for (const [name, control] of Object.entries(contextElements)) {
		const saved = preferenceStore.getItem(contextKeys[name])
		control.checked = saved === null ? name !== "defaultVisible" : saved !== "false"
	}
	// Keep at least one way to toggle visibility whenever the tracker is enabled.
	if (!contextElements.menu.checked && !contextElements.slash.checked) {
		contextElements.menu.checked = true
	}
	function syncContext() {
		const active = contextElements.enabled.checked
		contextControls.classList.toggle("inactive", !active)
		for (const [name, control] of Object.entries(contextElements)) {
			preferenceStore.setItem(contextKeys[name], String(control.checked))
			if (name !== "enabled") control.disabled = !active
		}
	}
	for (const [name, control] of Object.entries(contextElements)) {
		control.addEventListener("change", () => {
			if (name === "menu" || name === "slash") {
				if (!contextElements.menu.checked && !contextElements.slash.checked) {
					control.checked = true
					contextFeedback.textContent = "Keep at least one way to toggle the tracker enabled, or turn off the feature."
				} else contextFeedback.textContent = ""
			}
			syncContext()
		})
	}
	syncContext()
	const contextTarget = $("context-target")
	const contextTargetKey = "gpt-tweaks.context.target-tokens"
	const savedTarget = Number(preferenceStore.getItem(contextTargetKey))
	let lastValidTarget = Number.isSafeInteger(savedTarget) && savedTarget > 0 ? savedTarget : 512000
	contextTarget.value = String(lastValidTarget)
	// Text field without number spinners; persist on blur rather than
	// broadcasting every intermediate character through extension storage.
	contextTarget.addEventListener("input", () => {
		contextTarget.value = contextTarget.value.replace(/\D/g, "")
		contextTarget.setCustomValidity("")
	})
	function commitContextTarget() {
		const value = Number(contextTarget.value)
		if (contextTarget.value === "0") {
			lastValidTarget = 1
			preferenceStore.setItem(contextTargetKey, "1")
		} else if (contextTarget.value !== "" && Number.isSafeInteger(value) && value > 0) {
			lastValidTarget = value
			preferenceStore.setItem(contextTargetKey, String(value))
		}
		contextTarget.value = String(lastValidTarget)
		contextTarget.setCustomValidity("")
	}
	contextTarget.addEventListener("blur", commitContextTarget)
	contextTarget.addEventListener("keydown", event => {
		if (event.key === "Enter") { event.preventDefault(); contextTarget.blur() }
		if (event.key === "Escape") { event.preventDefault(); contextTarget.value = String(lastValidTarget); contextTarget.blur() }
	})
	// Reflect inline composer edits if the settings page is already open.
	if (globalThis.chrome?.storage?.onChanged) {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== "local" || !changes[contextTargetKey] || document.activeElement === contextTarget) return
			const value = Number(changes[contextTargetKey].newValue)
			if (Number.isSafeInteger(value) && value >= 1) {
				lastValidTarget = value
				contextTarget.value = String(value)
			}
		})
	}
	contextElements.enabled.addEventListener("change", () => {
		contextTarget.disabled = !contextElements.enabled.checked
	})
	contextTarget.disabled = !contextElements.enabled.checked

	// Session handoff and enhanced message copy
	const featureFlags = [
		["handoff-enabled", "gpt-tweaks.handoff.enabled"],
		["copy-enabled", "gpt-tweaks.copy.enabled"]
	]
	for (const [id, key] of featureFlags) {
		const checkbox = $(id)
		checkbox.checked = preferenceStore.getItem(key) !== "false"
		checkbox.addEventListener("change", () => preferenceStore.setItem(key, String(checkbox.checked)))
	}

	// New chat settings
	const newChatEnabled = $("new-chat-enabled")
	const newChatMiddle = $("new-chat-middle-click")
	const newChatSlash = $("new-chat-slash")
	const newChatDestination = $("new-chat-destination")
	const newChatControls = $("new-chat-controls")
	const newChatKeys = {
		enabled: "gpt-tweaks.new-chat.enabled",
		middle: "gpt-tweaks.new-chat.middle-click",
		slash: "gpt-tweaks.new-chat.slash",
		destination: "gpt-tweaks.new-chat.destination"
	}
	newChatEnabled.checked = preferenceStore.getItem(newChatKeys.enabled) !== "false"
	newChatMiddle.checked = preferenceStore.getItem(newChatKeys.middle) !== "false"
	newChatSlash.checked = preferenceStore.getItem(newChatKeys.slash) !== "false"
	newChatDestination.value = preferenceStore.getItem(newChatKeys.destination) === "window" ? "window" : "tab"
	if (!newChatMiddle.checked && !newChatSlash.checked) newChatMiddle.checked = true

	function syncNewChat() {
		const active = newChatEnabled.checked
		newChatControls.classList.toggle("inactive", !active)
		newChatMiddle.disabled = !active
		newChatSlash.disabled = !active
		newChatDestination.disabled = !active
		preferenceStore.setItem(newChatKeys.enabled, String(active))
		preferenceStore.setItem(newChatKeys.middle, String(newChatMiddle.checked))
		preferenceStore.setItem(newChatKeys.slash, String(newChatSlash.checked))
		preferenceStore.setItem(newChatKeys.destination, newChatDestination.value)
	}
	newChatEnabled.addEventListener("change", syncNewChat)
	for (const control of [newChatMiddle, newChatSlash]) {
		control.addEventListener("change", () => {
			if (!newChatMiddle.checked && !newChatSlash.checked) {
				control.checked = true
			}
			syncNewChat()
		})
	}
	newChatDestination.addEventListener("change", syncNewChat)
	syncNewChat()

	const links = [...document.querySelectorAll("[data-section]")]
	const targets = links.map(link => $(link.dataset.section))
	let explicitNavigateUntil = 0
	function setActive(id) {
		links.forEach(link => {
			if (link.dataset.section === id) link.setAttribute("aria-current", "location")
			else link.removeAttribute("aria-current")
		})
	}
	function updateActive() {
		if (performance.now() < explicitNavigateUntil) return
		const threshold = 130
		let active = targets[0].id
		for (const section of targets) {
			if (section.getBoundingClientRect().top <= threshold) active = section.id
		}
		setActive(active)
	}
	links.forEach(link =>
		link.addEventListener("click", () => {
			setActive(link.dataset.section)
			explicitNavigateUntil = performance.now() + 650
		})
	)
	window.addEventListener("scroll", updateActive, { passive: true })
	window.addEventListener("resize", updateActive)
	updateActive()
})()
