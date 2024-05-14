async function getUserAddon() {
  const allAddons = await browser.management.getAll()

  return allAddons.filter((extension) => {
    return (
      // Do not include itself
      extension.id !== browser.runtime.id &&
      // Reload extension
      extension.id !== 'reload@extension-js' &&
      // Show only unpackaged extensions
      extension.installType === 'development'
    )
  })
}

async function onStartup() {
  const userExtension = await getUserAddon()
  const extensionName = document.getElementById('extensionName')
  const extensionDescription = document.getElementById('extensionDescription')

  extensionName.innerText = userExtension[0].name
  extensionName.title = `• Name: ${userExtension[0].name}
• ID: ${userExtension[0].id}
• Version: ${userExtension[0].version}`

  extensionDescription.innerText = userExtension[0].description

  const learnMore = document.getElementById('learnMore')
  learnMore.addEventListener('click', () => {
    browser.tabs.create({url: 'https://extension.js.org/'})
  })
}

onStartup()
