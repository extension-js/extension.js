/* global chrome */

console.log('command listener opened in background')
chrome.commands.onCommand.addListener((command) => {
  console.log('command received on the background:', command)
})
