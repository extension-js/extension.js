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
  extensionName.innerText = userExtension[0].name

  document.getElementById('closeTab').addEventListener('click', () => {
    window.close()
  })

  const learnMore = document.getElementById('learnMore')
  learnMore.addEventListener('click', () => {
    chrome.tabs.create({url: 'https://docs.extensioncreate.com/'})
  })
}

onStartup()
