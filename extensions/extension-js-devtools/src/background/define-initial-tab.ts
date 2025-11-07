export async function getDevExtensions() {
  try {
    if (!chrome.management.getAll) return []

    const allExtensions = (await new Promise((resolve) => {
      chrome.management.getAll(resolve)
    })) as chrome.management.ExtensionInfo[]

    const devExtensions = (allExtensions || []).filter((extension) => {
      return (
        // Do not include itself
        extension.id !== chrome.runtime.id &&
        // Reload extension
        extension.id !== 'igcijhgmihmjbbahdabahfbpffalcfnn' &&
        // Show only unpackaged extensions
        extension.installType === 'development'
      )
    })

    return devExtensions
  } catch {
    return []
  }
}

export async function getDevExtension() {
  const devExtensions = await getDevExtensions()
  return devExtensions[0]
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
  // @ts-ignore
  const browser = import.meta.env.EXTENSION_BROWSER
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
  // @ts-ignore
  const browser = import.meta.env.EXTENSION_BROWSER
  const isFirefox = browser === 'firefox'
  const isEdge = browser === 'edge'
  const scheme = isFirefox ? 'about' : isEdge ? 'edge' : 'chrome'
  const extensionsPage = isFirefox ? 'about:addons' : `${scheme}://extensions/`

  chrome.tabs.update({url: extensionsPage})

  let devExtension: chrome.management.ExtensionInfo | undefined
  devExtension = await getDevExtension()

  // Use project-specific key when available; otherwise fall back to a global key
  const storageKey = devExtension?.id || '__global_first_run__'

  chrome.storage.local.get(storageKey, (result) => {
    if (result?.[storageKey]?.didRun) {
      return
    }

    // Guard against opening multiple welcome pages
    chrome.tabs.query(
      {url: chrome.runtime.getURL('pages/welcome.html')},
      (tabs) => {
        if (Array.isArray(tabs) && tabs.length > 0) {
          // Already open. Do not create another
          return
        }

        try {
          const welcomeUrl = chrome.runtime.getURL('pages/welcome.html')
          // @ts-ignore
          const browserStr = String(
            import.meta.env.EXTENSION_BROWSER || 'chromium'
          ).toLowerCase()
          const isEdgeBrowser = browserStr === 'edge'

          // Debug aid: show a one-time alert tab with the exact URL we
          // intend to open. This helps diagnose why Edge may not open
          // our extension page at startup.
          try {
            const debugHtml =
              '<!doctype html><meta charset="utf-8">' +
              `<script>alert(${JSON.stringify(
                `Opening welcome URL: ${welcomeUrl}`
              )});window.close();</script>`

            const debugUrl =
              'data:text/html;charset=utf-8,' + encodeURIComponent(debugHtml)

            // Prefer to show on Edge; safe on others if it runs
            if (isEdgeBrowser) {
              chrome.tabs.create({url: debugUrl, active: true})
            }
          } catch {
            // Ignore
          }

          // Attempt to open the actual welcome tab (active to surface it)
          chrome.tabs.create({url: welcomeUrl, active: true})
        } catch {
          // Fallback to relative URL if runtime URL resolution fails
          try {
            chrome.tabs.create({url: 'pages/welcome.html', active: true})
          } catch {
            // Ignore
          }
        }
      }
    )

    // Ensure the welcome page shows only once per extension installation
    chrome.storage.local.set({[storageKey]: {didRun: true}})
  })
}
