;(() => {
	"use strict"
	const $ = id => document.getElementById(id)
	const enabled = $("archive-enabled")
	const menu = $("method-menu")
	const slash = $("method-slash")
	const methods = $("attachment-methods")
	const feedback = $("method-feedback")
	const panel = $("private-panel")
	const token = $("token")
	const reveal = $("reveal-token")
	const removeToken = $("remove-token")
	const tokenMessage = $("token-message")
	const privateStatus = $("private-status")
	const preferences = {
		enabled: localStorage.getItem("gpt-tweaks.archives.enabled") !== "false",
		menu: localStorage.getItem("gpt-tweaks.archives.menu") !== "false",
		slash: localStorage.getItem("gpt-tweaks.archives.slash") !== "false"
	}
	// Credentials remain in this tab session; the finished extension will need a separate credential-storage design.
	token.value = sessionStorage.getItem("gpt-tweaks.github.token") || ""
	enabled.checked = preferences.enabled
	menu.checked = preferences.menu
	slash.checked = preferences.slash
	if (!menu.checked && !slash.checked) menu.checked = true

	function syncFeature() {
		methods.classList.toggle("inactive", !enabled.checked)
		menu.disabled = !enabled.checked
		slash.disabled = !enabled.checked
		localStorage.setItem("gpt-tweaks.archives.enabled", enabled.checked)
		localStorage.setItem("gpt-tweaks.archives.menu", menu.checked)
		localStorage.setItem("gpt-tweaks.archives.slash", slash.checked)
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

	let saveTimeout
	function syncTokenStatus() {
		const hasToken = Boolean(token.value.trim())
		privateStatus.textContent = hasToken ? "Token added" : "Not configured"
		privateStatus.classList.toggle("configured", hasToken)
		removeToken.hidden = !hasToken
	}
	function saveToken() {
		clearTimeout(saveTimeout)
		const value = token.value.trim()
		if (value) sessionStorage.setItem("gpt-tweaks.github.token", value)
		else sessionStorage.removeItem("gpt-tweaks.github.token")
		syncTokenStatus()
		tokenMessage.textContent = value ? "Saved" : ""
	}
	token.addEventListener("input", () => {
		tokenMessage.textContent = ""
		clearTimeout(saveTimeout)
		syncTokenStatus()
		saveTimeout = setTimeout(saveToken, 450)
	})
	token.addEventListener("blur", saveToken)
	reveal.addEventListener("click", () => {
		const exposed = token.type === "password"
		token.type = exposed ? "text" : "password"
		reveal.textContent = exposed ? "Hide" : "Show"
		reveal.setAttribute("aria-label", exposed ? "Hide token" : "Show token")
	})
	removeToken.addEventListener("click", () => {
		clearTimeout(saveTimeout)
		token.value = ""
		sessionStorage.removeItem("gpt-tweaks.github.token")
		tokenMessage.textContent = "Removed"
		syncTokenStatus()
		token.focus()
	})
	syncTokenStatus()

	// Conversation context-tracker preferences
	const contextKeys = {
		enabled: "gpt-tweaks.context.enabled",
		defaultVisible: "gpt-tweaks.context.default-visible",
		menu: "gpt-tweaks.context.menu",
		slash: "gpt-tweaks.context.slash",
		percent: "gpt-tweaks.context.percent",
		tokens: "gpt-tweaks.context.tokens",
		limit: "gpt-tweaks.context.limit",
		messages: "gpt-tweaks.context.messages"
	}
	const contextElements = {
		enabled: $("context-enabled"),
		defaultVisible: $("context-default-visible"),
		menu: $("context-menu"),
		slash: $("context-slash"),
		percent: $("context-show-percent"),
		tokens: $("context-show-tokens"),
		limit: $("context-show-limit"),
		messages: $("context-show-messages")
	}
	const contextControls = $("context-controls")
	const contextFeedback = $("context-feedback")
	for (const [name, control] of Object.entries(contextElements)) {
		control.checked = localStorage.getItem(contextKeys[name]) !== "false"
	}
	// Keep at least one way to toggle visibility whenever the tracker is enabled.
	if (!contextElements.menu.checked && !contextElements.slash.checked) {
		contextElements.menu.checked = true
	}
	function syncContext() {
		const active = contextElements.enabled.checked
		contextControls.classList.toggle("inactive", !active)
		for (const [name, control] of Object.entries(contextElements)) {
			localStorage.setItem(contextKeys[name], String(control.checked))
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
	const savedTarget = Number(localStorage.getItem(contextTargetKey))
	let lastValidTarget = Number.isSafeInteger(savedTarget) && savedTarget > 0 ? savedTarget : 128000
	contextTarget.value = String(lastValidTarget)
	function saveContextTarget() {
		const value = Number(contextTarget.value)
		if (contextTarget.value.trim() !== "" && Number.isSafeInteger(value) && value > 0) {
			lastValidTarget = value
			localStorage.setItem(contextTargetKey, String(value))
			contextTarget.setCustomValidity("")
		} else {
			contextTarget.setCustomValidity("Enter a positive whole number.")
		}
	}
	contextTarget.addEventListener("input", saveContextTarget)
	contextTarget.addEventListener("blur", () => {
		if (!contextTarget.validity.valid) {
			contextTarget.value = String(lastValidTarget)
			contextTarget.setCustomValidity("")
		}
	})
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
		checkbox.checked = localStorage.getItem(key) !== "false"
		checkbox.addEventListener("change", () => localStorage.setItem(key, String(checkbox.checked)))
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
	newChatEnabled.checked = localStorage.getItem(newChatKeys.enabled) !== "false"
	newChatMiddle.checked = localStorage.getItem(newChatKeys.middle) !== "false"
	newChatSlash.checked = localStorage.getItem(newChatKeys.slash) !== "false"
	newChatDestination.value = localStorage.getItem(newChatKeys.destination) === "window" ? "window" : "tab"
	if (!newChatMiddle.checked && !newChatSlash.checked) newChatMiddle.checked = true

	function syncNewChat() {
		const active = newChatEnabled.checked
		newChatControls.classList.toggle("inactive", !active)
		newChatMiddle.disabled = !active
		newChatSlash.disabled = !active
		newChatDestination.disabled = !active
		localStorage.setItem(newChatKeys.enabled, String(active))
		localStorage.setItem(newChatKeys.middle, String(newChatMiddle.checked))
		localStorage.setItem(newChatKeys.slash, String(newChatSlash.checked))
		localStorage.setItem(newChatKeys.destination, newChatDestination.value)
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
			if (link.dataset.section === "private-access") panel.open = true
			setActive(link.dataset.section)
			explicitNavigateUntil = performance.now() + 650
		})
	)
	window.addEventListener("scroll", updateActive, { passive: true })
	window.addEventListener("resize", updateActive)
	updateActive()
})()
