export async function getDevExtensions() {
  try {
    if (!chrome.management.getAll) return []

    const allExtensions = (await new Promise((resolve) => {
      chrome.management.getAll(resolve)
    })) as chrome.management.ExtensionInfo[]

    const isBuiltIn = (extension: chrome.management.ExtensionInfo) => {
      const name = String(extension.name || '').toLowerCase()

      return (
        // Built-in devtools
        name.includes('extension.js built-in developer tools') ||
        name.includes('extension.js theme')
      )
    }

    const devExtensions = (allExtensions || []).filter((extension) => {
      return (
        // Do not include itself
        extension.id !== chrome.runtime.id &&
        // Reload extension
        extension.id !== 'igcijhgmihmjbbahdabahfbpffalcfnn' &&
        // Show only unpackaged extensions
        extension.installType === 'development' &&
        // Exclude themes so we pick the actual user extension
        // (Chrome reports themes via management API)
        extension.type !== 'theme' &&
        // Must be enabled to be useful
        extension.enabled === true &&
        // Also exclude our built-ins by name/description
        !isBuiltIn(extension)
      )
    })

    return devExtensions
  } catch {
    return []
  }
}

export async function getDevExtension() {
  const devExtensions = await getDevExtensions()
  // Prefer the last registered dev extension (user extension appended last)
  return devExtensions[devExtensions.length - 1]
}

// Ideas here are adapted from
// https://github.com/jeremyben/webpack-chrome-extension-launcher
// Released under MIT license.

// Create a new tab and set it to background.
// We want the user-selected page to be active,
// not chrome://extensions.
export function createExtensionsPageTab(
  initialTab: chrome.tabs.Tab,
  url: string
) {
  const browser = (import.meta as any).env?.EXTENSION_BROWSER
  const isFirefox = browser === 'firefox'
  const isEdge = browser === 'edge'
  const scheme = isFirefox ? 'about' : isEdge ? 'edge' : 'chrome'
  const extensionsPage = isFirefox ? 'about:addons' : `${scheme}://extensions/`

  // Check if url tab is open
  chrome.tabs.query({url: extensionsPage}, (tabs) => {
    const extensionsTabExist = tabs.length > 0

    // Return if url exists
    if (extensionsTabExist) return

    // Create an inactive tab
    chrome.tabs.create(
      {url: extensionsPage, active: false},
      function setBackgroundTab(extensionsTab) {
        // Get current url tab and move it left.
        // This action auto-activates the tab
        chrome.tabs.move(extensionsTab.id!, {index: 0}, () => {
          // Get user-selected initial page tab and activate the right tab
          setTimeout(() => {
            chrome.tabs.update(initialTab.id!, {active: true})
          }, 500)
        })
      }
    )
  })
}

// Function to handle first run logic
export async function handleFirstRun() {
  const browser = (import.meta as any).env?.EXTENSION_BROWSER
  const isFirefox = browser === 'firefox'
  const isEdge = browser === 'edge'
  const scheme = isFirefox ? 'about' : isEdge ? 'edge' : 'chrome'
  const extensionsPage = isFirefox ? 'about:addons' : `${scheme}://extensions/`

  // Capture the current active tab id so we can repurpose it (Chromium/Edge)
  // after opening the welcome tab in front.
  let originalActiveTabId: number | undefined
  try {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const tab = Array.isArray(tabs) ? tabs[0] : undefined
      if (tab && typeof tab.id === 'number') originalActiveTabId = tab.id
    })
  } catch {
    console.error('Error querying active tab')
  }

  let devExtension: chrome.management.ExtensionInfo | undefined
  devExtension = await getDevExtension()

  // Use project-specific key when available; otherwise fall back to a global key
  const browserStr = String(
    // @ts-ignore
    import.meta.env?.EXTENSION_BROWSER || 'chromium'
  ).toLowerCase()
  const storageKey = devExtension?.id || `__first_run__:${browserStr}`

  chrome.storage.local.get(storageKey, async (result) => {
    if (result?.[storageKey]?.didRun) {
      return
    }

    // Promise-wrap `chrome.tabs.create` so we know the welcome tab is actually
    // open before we commit `didRun`. Firefox MV2's `chrome.*` API is a
    // best-effort callback bridge over the native Promise-returning API:
    // certain calls leave the callback unresolved without throwing. Relying
    // on the callback for control flow there silently no-oped the previous
    // implementation, and didRun was set anyway → the welcome page never
    // surfaced for that user again
    const createTab = (createProperties: chrome.tabs.CreateProperties) =>
      new Promise<chrome.tabs.Tab | undefined>((resolve) => {
        try {
          const ret = chrome.tabs.create(createProperties, (tab) => {
            if (chrome.runtime.lastError) {
              console.error(
                'Error creating tab:',
                chrome.runtime.lastError.message
              )
              resolve(undefined)
              return
            }
            resolve(tab)
          })
          // Firefox returns a Promise from `chrome.tabs.create`. Bridge it.
          if (ret && typeof (ret as Promise<chrome.tabs.Tab>).then === 'function') {
            ;(ret as Promise<chrome.tabs.Tab>).then(resolve, () =>
              resolve(undefined)
            )
          }
        } catch (error) {
          console.error('Error creating tab:', error)
          resolve(undefined)
        }
      })

    let opened: chrome.tabs.Tab | undefined
    try {
      const welcomeUrl = chrome.runtime.getURL('pages/welcome.html')

      if (isFirefox) {
        opened = await createTab({url: welcomeUrl, active: true})

        // Ensure the addons manager exists in the background for convenience.
        // Best-effort: not gated on the welcome tab guard.
        try {
          chrome.tabs.query({url: 'about:addons'}, (xtabs) => {
            if (!Array.isArray(xtabs) || xtabs.length === 0) {
              void createTab({url: 'about:addons', active: false})
            }
          })
        } catch {
          console.error('Error querying addons tab')
        }
      } else {
        opened = await createTab({url: welcomeUrl, active: true})

        // Then update the original active tab to the extensions page
        // in the background (avoid stealing focus on Edge).
        if (typeof originalActiveTabId === 'number') {
          try {
            chrome.tabs.update(originalActiveTabId, {url: extensionsPage})
          } catch {
            console.error('Error updating original active tab')
          }
        }
      }
    } catch {
      // Fallback to relative URL if runtime URL resolution fails
      opened = await createTab({url: 'pages/welcome.html', active: true})
    }

    // Only commit didRun after the welcome tab is confirmed open. If the
    // creation failed, leave didRun unset so the next install/startup retries
    if (opened) {
      chrome.storage.local.set({[storageKey]: {didRun: true}})
    }
  })
}
