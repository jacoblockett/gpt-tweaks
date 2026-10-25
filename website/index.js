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

	// New chat controls
	const newChatEnabled = $("new-chat-enabled")
	const newChatMiddle = $("new-chat-middle-click")
	const newChatShortcut = $("new-chat-shortcut")
	const newChatShortcutClear = $("new-chat-shortcut-clear")
	const newChatStatus = $("new-chat-shortcut-status")
	const newChatDestination = $("new-chat-destination")
	const newChatControls = $("new-chat-controls")
	const newChatKeys = {
		enabled: "gpt-tweaks.new-chat.enabled",
		middle: "gpt-tweaks.new-chat.middle-click",
		shortcut: "gpt-tweaks.new-chat.shortcut",
		destination: "gpt-tweaks.new-chat.destination"
	}
	let savedShortcut = localStorage.getItem(newChatKeys.shortcut) || ""
	let recordingShortcut = false
	newChatEnabled.checked = localStorage.getItem(newChatKeys.enabled) !== "false"
	newChatMiddle.checked = localStorage.getItem(newChatKeys.middle) !== "false"
	newChatDestination.value = localStorage.getItem(newChatKeys.destination) === "window" ? "window" : "tab"
	if (!newChatMiddle.checked && !savedShortcut) newChatMiddle.checked = true

	function updateShortcutDisplay() {
		newChatShortcut.textContent = recordingShortcut ? "Press keys…" : savedShortcut || "Set shortcut"
		newChatShortcut.classList.toggle("is-recording", recordingShortcut)
		newChatShortcut.setAttribute(
			"aria-label",
			recordingShortcut
				? "Press shortcut keys, or Escape to cancel"
				: savedShortcut
					? "Change keyboard shortcut"
					: "Set keyboard shortcut"
		)
		newChatShortcutClear.hidden = !savedShortcut
	}
	function syncNewChat() {
		newChatControls.classList.toggle("inactive", !newChatEnabled.checked)
		newChatMiddle.disabled = !newChatEnabled.checked
		newChatShortcut.disabled = !newChatEnabled.checked
		newChatShortcutClear.disabled = !newChatEnabled.checked
		newChatDestination.disabled = !newChatEnabled.checked
		localStorage.setItem(newChatKeys.enabled, String(newChatEnabled.checked))
		localStorage.setItem(newChatKeys.middle, String(newChatMiddle.checked))
		localStorage.setItem(newChatKeys.destination, newChatDestination.value)
	}
	function stopShortcutRecording() {
		recordingShortcut = false
		window.removeEventListener("keydown", captureNewChatShortcut, true)
		updateShortcutDisplay()
	}
	newChatEnabled.addEventListener("change", () => {
		if (!newChatEnabled.checked && recordingShortcut) stopShortcutRecording()
		newChatStatus.textContent = ""
		syncNewChat()
	})
	newChatMiddle.addEventListener("change", () => {
		if (!newChatMiddle.checked && !savedShortcut) {
			newChatMiddle.checked = true
			newChatStatus.textContent = "Set a keyboard shortcut before disabling middle-click."
		} else newChatStatus.textContent = ""
		syncNewChat()
	})
	newChatDestination.addEventListener("change", () => syncNewChat())
	// Browser- and operating-system-reserved shortcuts cannot be safely reassigned.
	const reservedNewChatShortcuts = new Set([
		"Ctrl+T",
		"Ctrl+N",
		"Ctrl+W",
		"Ctrl+R",
		"Ctrl+L",
		"Ctrl+F",
		"Ctrl+P",
		"Ctrl+S",
		"Ctrl+D",
		"Ctrl+O",
		"Ctrl+H",
		"Ctrl+J",
		"Ctrl+U",
		"Ctrl+Shift+T",
		"Ctrl+Shift+N",
		"Ctrl+Shift+W",
		"Meta+T",
		"Meta+N",
		"Meta+W",
		"Meta+R",
		"Meta+L",
		"Meta+F",
		"Meta+Shift+T",
		"Meta+Shift+N"
	])
	function captureNewChatShortcut(event) {
		if (!recordingShortcut) return
		if (event.key === "Escape") {
			event.preventDefault()
			stopShortcutRecording()
			newChatStatus.textContent = ""
			return
		}
		if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return
		const letter = event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase()
		if (!/^[A-Z0-9]$/.test(letter) && !/^F([1-9]|1[0-2])$/.test(letter)) {
			event.preventDefault()
			newChatStatus.textContent = "Choose a letter, number, or function key with a modifier."
			return
		}
		if (!event.ctrlKey && !event.altKey && !event.metaKey) {
			event.preventDefault()
			newChatStatus.textContent = "Include Ctrl, Alt, or Meta in the shortcut."
			return
		}
		const chord = [
			...(event.ctrlKey ? ["Ctrl"] : []),
			...(event.altKey ? ["Alt"] : []),
			...(event.shiftKey ? ["Shift"] : []),
			...(event.metaKey ? ["Meta"] : []),
			letter
		].join("+")
		event.preventDefault()
		event.stopPropagation()
		if (reservedNewChatShortcuts.has(chord)) {
			newChatStatus.textContent = "This shortcut is reserved by the browser. Choose another."
			return
		}
		savedShortcut = chord
		localStorage.setItem(newChatKeys.shortcut, savedShortcut)
		stopShortcutRecording()
		newChatStatus.textContent = ""
	}
	newChatShortcut.addEventListener("click", () => {
		if (recordingShortcut) {
			stopShortcutRecording()
			return
		}
		recordingShortcut = true
		newChatStatus.textContent = "Press a key combination. Escape cancels."
		updateShortcutDisplay()
		window.addEventListener("keydown", captureNewChatShortcut, true)
	})
	newChatShortcutClear.addEventListener("click", () => {
		savedShortcut = ""
		localStorage.removeItem(newChatKeys.shortcut)
		if (!newChatMiddle.checked) {
			newChatMiddle.checked = true
			newChatStatus.textContent = "Middle-click enabled because no shortcut is assigned."
		} else newChatStatus.textContent = ""
		updateShortcutDisplay()
		syncNewChat()
	})
	updateShortcutDisplay()
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
