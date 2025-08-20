// Raw background: rely on global-scope functions provided by included scripts

function bgGreen(str) {
  return `background: transparent; color: #0971fe; ${str}`
}

async function handleTabOnExtensionLoad() {
  console.log(
    `%c
██████████████████████████████████████████████████████████
██████████████████████████████████████████████████████████
████████████████████████████    ██████████████████████████
█████████████████████████        ██████    ███████████████
███████████████████████     ███   ███         ████████████
██████████████████████    ██████        ███    ███████████
███████████████████████     ██████    ██████   ███████████
████████████████   ██████   ██████████████     ███████████
█████████████       ████    ████████████      ████████████
███████████     ██         █████████████   ███████████████
██████████    ██████    █████████████████    █████████████
███████████    ████████████████████████████    ███████████
█████████████    █████████████████    ██████    ██████████
███████████████   ██████████████        ██      ██████████
████████████      ████████████    ████       █████████████
███████████      █████████████   ██████    ███████████████
███████████   ██████    ██████     ███████████████████████
███████████    ████       ██████    ██████████████████████
████████████         ██    ███     ███████████████████████
███████████████    ██████        █████████████████████████
██████████████████████████    ████████████████████████████
██████████████████████████████████████████████████████████
██████████████████████████████████████████████████████████
MIT (c) ${new Date().getFullYear()} - Cezar Augusto and the Extension.js Authors.
`,
    bgGreen('')
  )

  try {
    await handleFirstRun()
  } catch (error) {
    console.error(
      '[Extension.js] Error handling tabs on extension load:',
      error
    )
  }
  try {
    const [initialTab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    })
    if (initialTab) {
      await createFirefoxAddonsTab(initialTab, 'about:blank')
    }
  } catch {}
}

// Run on install and on startup to ensure welcome/connection behavior is reliable
browser.runtime.onInstalled.addListener(async () => {
  try {
    await handleFirstRun()
  } catch {}
  try {
    await handleTabOnExtensionLoad()
  } catch {}
  try {
    await connect()
  } catch {}
})

browser.runtime.onStartup.addListener(async () => {
  try {
    await handleFirstRun()
  } catch {}
  try {
    await handleTabOnExtensionLoad()
  } catch {}
  try {
    await connect()
  } catch {}
})

// Attempt immediate connection for resilience
try {
  connect()
} catch {}
