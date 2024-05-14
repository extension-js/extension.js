// Create a new tab and set it to background.
// We want the user-selected page to be active,
// not about:blank.
async function createFirefoxAddonsTab(initialTab, url) {
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

const __IS_FIRST_RUN__ = false

async function handleTabOnExtensionLoad() {
  try {
    const [initialTab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    })

    console.log({kkkL: 'ok', initurl: initialTab.url, __IS_FIRST_RUN__})
    if (initialTab.url === 'about:blank') {
      // This check is generated at runtime by a hypothetical function,
      // handle accordingly if it's the first run
      if (true) {
        console.log('i am reached')
        setTimeout(async () => {
          await browser.tabs.create({url: './pages/welcome.html'})
        }, 1000)
      }
    } else {
      createFirefoxAddonsTab(initialTab, 'about:blank')
    }
  } catch (error) {
    console.error('Error handling tabs on extension load:', error)
  }
}

handleTabOnExtensionLoad()
