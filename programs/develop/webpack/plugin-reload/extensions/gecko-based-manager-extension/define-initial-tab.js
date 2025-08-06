async function getDevExtension() {
  const allExtensions = await browser.management.getAll()

  return allExtensions.filter((extension) => {
    return (
      // Reload extension
      extension.name !== 'Extension.js DevTools' &&
      // Show only unpackaged extensions
      extension.installType === 'development'
    )
  })[0]
}

// Create a new tab and set it to background.
export async function createFirefoxAddonsTab(initialTab, url) {
  try {
    // Check if an about:blank tab is already open
    const tabs = await browser.tabs.query({url: 'about:blank'})
    const addonsTabExist = tabs.length > 0

    // Return if url exists, meaning about:blank tab is already open
    if (addonsTabExist) return

    // Create an inactive about:blank tab
    const addonsTab = await browser.tabs.create({url, active: false})

    // Get the initial page tab and move the new addons tab to the first position.
    // This will auto-activate the initial page tab because we set the addons tab to inactive
    await browser.tabs.move(addonsTab.id, {index: 0})

    // Reactivate the user-selected initial page tab
    await browser.tabs.update(initialTab.id, {active: true})
  } catch (error) {
    console.error('Error creating and manipulating tabs:', error)
  }
}

// Function to handle first run logic
export async function handleFirstRun() {
  try {
    const devExtension = await getDevExtension()

    if (!devExtension) {
      console.warn('No development extensions found')
      return
    }

    // Use a more robust check that combines storage with a session flag
    const storageKey = `welcome_shown_${devExtension.id}`

    const result = await browser.storage.local.get([
      storageKey,
      'welcome_session_flags'
    ])
    const hasShownWelcome = result[storageKey] && result[storageKey].didRun
    const sessionFlags = result.welcome_session_flags || {}
    const hasShownInSession = sessionFlags[devExtension.id]

    if (hasShownWelcome || hasShownInSession) {
      return
    }

    // Open the welcome page
    await browser.tabs.create({url: './pages/welcome.html'})

    // Set both persistent and session flags to ensure it doesn't show again
    const updates = {
      [storageKey]: {didRun: true, timestamp: Date.now()},
      welcome_session_flags: {
        ...sessionFlags,
        [devExtension.id]: true
      }
    }

    await browser.storage.local.set(updates)
  } catch (error) {
    console.error('Error handling tabs on extension load:', error)
  }
}
