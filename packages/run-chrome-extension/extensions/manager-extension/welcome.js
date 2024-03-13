async function getUserExtension() {
  const allExtensions = await chrome.management.getAll()

  return allExtensions.filter((extension) => {
    return (
      // Do not include itself
      extension.id !== chrome.runtime.id &&
      // Reload extension
      extension.id !== 'igcijhgmihmjbbahdabahfbpffalcfnn' &&
      // Show only unpackaged extensions
      extension.installType === 'development'
    )
  })
}

async function onStartup() {
  const userExtension = await getUserExtension()
  const extensionName = document.getElementById('extensionName')
  const extensionDescription = document.getElementById('extensionDescription')

  extensionName.innerText = userExtension[0].name
  extensionName.title = `• Name: ${userExtension[0].name}
• ID: ${userExtension[0].id}
• Version: ${userExtension[0].version}`

  extensionDescription.innerText = userExtension[0].description

  const learnMore = document.getElementById('learnMore')
  learnMore.addEventListener('click', () => {
    chrome.tabs.create({url: 'https://docs.extensioncreate.com/'})
  })
}

onStartup()
