async function getDevExtension() {
  const allExtensions = await browser.management.getAll()

  return allExtensions.filter((extension) => {
    return (
      // Reload extension
      extension.name !== 'Extension.js DevTools' &&
      // Show only unpackaged extensions (Firefox reports "temporary")
      (extension.installType === 'development' ||
        extension.installType === 'temporary')
    )
  })[0]
}

// Create a new tab and set it to background.
async function createFirefoxAddonsTab(initialTab, url) {
  try {
    // If a tab with the desired URL already exists, do nothing
    const existing = await browser.tabs.query({url})
    if (existing && existing.length > 0) return

    // Create an inactive tab with the requested URL
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
async function handleFirstRun() {
  try {
    const devExtension = await getDevExtension()

    if (!devExtension) {
      console.warn('No development extensions found')
      return
    }

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
