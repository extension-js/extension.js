function handleShown() {
  console.log('panel visible')
}

function handleHidden() {
  console.log('panel invisible')
}

browser.devtools.panels.create(
  'Add-On Panel',
  'public/icon/test_32.png',
  'devtools/devtools.html',
  (newPanel) => {
    newPanel.onShown.addListener(handleShown)
    newPanel.onHidden.addListener(handleHidden)
  }
)
