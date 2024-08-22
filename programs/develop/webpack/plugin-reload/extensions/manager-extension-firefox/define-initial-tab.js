async function getDevExtension() {
  const allExtensions = await browser.management.getAll()

  return allExtensions.filter((extension) => {
    return (
      // Do not include itself
      extension.id !== browser.runtime.id &&
      // Reload extension
      extension.name !== 'Extension Manager' &&
      // Show only unpackaged extensions
      extension.installType === 'development'
    )
  })
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
    const devExtensions = await getDevExtension()

    if (devExtensions.length === 0) {
      console.warn('No development extensions found')
      return
    }

    const devExtension = await getDevExtension()
    const result = await browser.storage.local.get(devExtension.id)

    if (result[devExtension.id] && result[devExtension.id].didRun) {
      return
    }

    // Open the welcome page
    await browser.tabs.create({url: './pages/welcome.html'})

    // Ensure the welcome page shows only once per extension installation
    await browser.storage.local.set({[devExtension.id]: {didRun: true}})
  } catch (error) {
    console.error('Error handling tabs on extension load:', error)
  }
}
