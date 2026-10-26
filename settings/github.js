(() => {
"use strict";
globalThis.__gptTweaksInitGitHubSettings=async ($,preferenceStore)=>{
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


};
})();