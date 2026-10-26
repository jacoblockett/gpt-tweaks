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

	// Device authorization is handled in the trusted extension service worker.
	const githubStatus = $("github-account-status")
	const githubDescription = $("github-account-description")
	const githubControls = $("github-account-controls")
	const githubDeviceCode = $("github-device-code")
	const githubAuthError = $("github-auth-error")
	const githubSignIn = $("github-sign-in")
	const githubInstallAction = $("github-install-action")
	const githubDisconnect = $("github-disconnect")
	let githubConnected = false
	let githubAccount = ""
	let githubSupported = false
	let authorizationPending = false
	let installationPending = false
	let installationChecking = false
	let installedOnAccount = false
	let lastInstallCheck = 0
	const installationDescription =
		"Your GitHub account is now connected. To access your private repositories through GPT Tweaks, " +
		"you'll also need to install the GPT Tweaks application on GitHub."

	function githubRequest(kind, extra = {}) {
		return chrome.runtime.sendMessage({ kind: "gpt-github-" + kind, ...extra }).then(reply => {
			if (!reply?.ok) throw new Error(reply?.error || "GitHub request failed.")
			return reply.data
		})
	}
	function clearGithubError() {
		githubAuthError.textContent = ""
		githubAuthError.hidden = true
	}
	function showGithubError(error) {
		githubAuthError.textContent = error.message || String(error)
		githubAuthError.hidden = false
	}
	function showGithubAccount() {
		const fullyConnected = githubConnected && installedOnAccount
		githubStatus.textContent = authorizationPending || !githubConnected
			? "Not connected"
			: (fullyConnected ? "Connected" : "Signed in") + (githubAccount ? " as " + githubAccount : "")
		githubStatus.classList.toggle("connected", githubConnected && !authorizationPending)
		githubDescription.hidden = fullyConnected
		githubDescription.textContent = authorizationPending
			? "A GitHub tab asking for a code should have opened automatically asking to verify your session. Enter the following code and complete the authorization process."
			: githubConnected ? installationDescription : "Connect your GitHub account to allow GitHub-related utilities to read from your private repositories."
		githubDeviceCode.hidden = !authorizationPending
		githubControls.hidden = authorizationPending
		githubSignIn.hidden = githubConnected
		githubSignIn.disabled = !githubSupported
		githubSignIn.title = githubSupported ? "" : "GitHub App client ID is not configured yet"
		githubInstallAction.hidden = !githubConnected || fullyConnected
		githubDisconnect.hidden = !githubConnected
	}
	async function refreshGithubInstallation() {
		if (installationChecking || !githubConnected) return
		installationChecking = true
		lastInstallCheck = Date.now()
		try {
			const state = await githubRequest("install-status")
			if (!githubConnected) return
			installedOnAccount = state.connected && state.installationsCount > 0
			if (installedOnAccount || !state.connected) installationPending = false
			showGithubAccount()
		} catch (error) {
			// An unavailable installation check must not imply a completed installation.
			console.warn("GitHub installation status unavailable:", error)
		} finally { installationChecking = false }
	}
	githubInstallAction.addEventListener("click", async () => {
		githubInstallAction.disabled = true
		clearGithubError()
		try {
			await githubRequest("install-open")
			installationPending = true
		} catch (error) {
			showGithubError(error)
		} finally { githubInstallAction.disabled = false }
	})
	window.addEventListener("focus", () => {
		if (installationPending && Date.now() - lastInstallCheck > 1200)
			void refreshGithubInstallation()
	})
	async function renderGithubAccount() {
		if (!globalThis.chrome?.runtime?.id) return
		try {
			const state = await githubRequest("auth-status")
			githubConnected = !!state.connected
			githubAccount = state.account || ""
			githubSupported = !!state.supported
			if (!githubConnected) {
				installationPending = false
				installedOnAccount = false
			}
			showGithubAccount()
			if (githubConnected) await refreshGithubInstallation()
		} catch (error) { showGithubError(error) }
	}
	githubSignIn.addEventListener("click", async () => {
		githubSignIn.disabled = true
		clearGithubError()
		try {
			const auth = await githubRequest("auth-start")
			githubDeviceCode.textContent = auth.user_code
			authorizationPending = true
			showGithubAccount()
			await githubRequest("auth-open")
			const until = Date.now() + auth.expires_in * 1000
			let interval = auth.interval * 1000
			let connected = false
			while (Date.now() < until) {
				await new Promise(resolve => setTimeout(resolve, interval))
				const response = await githubRequest("auth-poll")
				if (response.connected) { connected = true; break }
				interval = Math.max(interval, response.interval * 1000)
			}
			if (!connected) throw new Error("GitHub authorization expired.")
			authorizationPending = false
			githubDeviceCode.textContent = ""
			await renderGithubAccount()
		} catch (error) {
			authorizationPending = false
			githubDeviceCode.textContent = ""
			showGithubAccount()
			showGithubError(error)
		} finally { githubSignIn.disabled = !githubSupported || githubConnected }
	})
	githubDisconnect.addEventListener("click", async () => {
		githubDisconnect.disabled = true
		clearGithubError()
		try {
			await githubRequest("auth-disconnect")
			githubConnected = false
			githubAccount = ""
			installedOnAccount = false
			installationPending = false
			showGithubAccount()
		} catch (error) { showGithubError(error) }
		finally { githubDisconnect.disabled = false }
	})
	void renderGithubAccount()

	const historyKey = "gpt-tweaks.github.repository-history"
	const historyStatus = $("repository-history-status")
	const clearHistory = $("clear-repository-history")
	const historyFeedback = $("repository-history-feedback")
	function historyCount() {
		try {
			const saved = JSON.parse(preferenceStore.getItem(historyKey) || "[]")
			return Array.isArray(saved) ? saved.length : 0
		} catch {
			return 0
		}
	}
	function renderHistoryStatus() {
		const count = historyCount()
		historyStatus.textContent =
			count === 0 ? "No repositories saved yet." :
			`${count} ${count === 1 ? "repository" : "repositories"} saved.`
		clearHistory.hidden = count === 0
	}
	clearHistory.addEventListener("click", () => {
		preferenceStore.removeItem(historyKey)
		renderHistoryStatus()
		historyFeedback.textContent = "History cleared."
	})
	renderHistoryStatus()
	if (globalThis.chrome?.storage?.onChanged) {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === "local" && changes[historyKey]) {
				const value = changes[historyKey].newValue
				let count = 0
				try { const items = JSON.parse(value || "[]");count = Array.isArray(items) ? items.length : 0 } catch {}
				historyStatus.textContent = count === 0 ? "No repositories saved yet." :
					count + (count === 1 ? " repository saved." : " repositories saved.")
				clearHistory.hidden = count === 0
			}
			if (area === "local" && (changes["gpt-tweaks.github.auth"] || changes["gpt-tweaks.github.account"])) {
				void renderGithubAccount()
			}
		})
	}

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
	function saveContextTarget() {
		const value = Number(contextTarget.value)
		if (contextTarget.value.trim() !== "" && Number.isSafeInteger(value) && value > 0) {
			lastValidTarget = value
			preferenceStore.setItem(contextTargetKey, String(value))
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
