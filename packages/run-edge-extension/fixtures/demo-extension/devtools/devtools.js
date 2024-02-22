/* global chrome */

function handleShown() {
  console.log('panel visible')
}

function handleHidden() {
  console.log('panel invisible')
}

chrome.devtools.panels.create(
  'Extension Panel',
  'public/icon/test_32.png',
  'devtools/devtools.html',
  (newPanel) => {
    newPanel.onShown.addListener(handleShown)
    newPanel.onHidden.addListener(handleHidden)
  }
)
