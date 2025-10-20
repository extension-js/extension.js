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
  const isFirefox = import.meta.env.EXTENSION_BROWSER === 'firefox'
  const extensionsPage = isFirefox ? 'about:addons' : 'chrome://extensions/'
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
  const isFirefox = import.meta.env.EXTENSION_BROWSER === 'firefox'
  const extensionsPage = isFirefox ? 'about:addons' : 'chrome://extensions/'
  chrome.tabs.update({url: extensionsPage})

  const devExtension = await getDevExtension()

  if (!devExtension) {
    return
  }

  chrome.storage.local.get(devExtension.id, (result) => {
    if (result[devExtension.id] && result[devExtension.id].didRun) {
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
        chrome.tabs.create({url: 'pages/welcome.html'})
      }
    )

    // Ensure the welcome page shows only once per extension installation
    chrome.storage.local.set({[devExtension.id]: {didRun: true}})
  })
}
