;(async () => {
	"use strict"
	const { ready, preferences: store } = globalThis.GPTTweaksStorage
	await ready
	const $ = id => document.getElementById(id)

	// Retain only feature-level controls. Legacy plus/slash and display
	// preferences remain in storage but are no longer presented or rewritten.
	const featureKeys = [
		["archive-enabled", "gpt-tweaks.archives.enabled"],
		["copy-enabled", "gpt-tweaks.copy.enabled"],
		["notifications-enabled", "gpt-tweaks.notifications.enabled"],
		["handoff-enabled", "gpt-tweaks.handoff.enabled"],
		["context-enabled", "gpt-tweaks.context.enabled"],
		["new-chat-enabled", "gpt-tweaks.new-chat.enabled"]
	]
	for (const [id, key] of featureKeys) {
		const control = $(id)
		control.checked = store.getItem(key) !== "false"
		control.addEventListener("change", () => {
			store.setItem(key, String(control.checked))
			if (id === "new-chat-enabled") syncNewChat()
		})
	}

	await globalThis.__gptTweaksInitGitHubSettings($, store)

	const destination = $("new-chat-destination")
	const destinationKey = "gpt-tweaks.new-chat.destination"
	const enabled = $("new-chat-enabled")
	const destinationControls = $("new-chat-controls")
	destination.value = store.getItem(destinationKey) === "window" ? "window" : "tab"
	const dropdown = globalThis.GPTTweaksSelect(destination,
		$("new-chat-destination-trigger"), $("new-chat-destination-options"))
	function syncNewChat() {
		const active = enabled.checked
		destinationControls.classList.toggle("inactive", !active)
		destination.disabled = !active
		dropdown.sync()
	}
	destination.addEventListener("change", () =>
		store.setItem(destinationKey, destination.value))
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
