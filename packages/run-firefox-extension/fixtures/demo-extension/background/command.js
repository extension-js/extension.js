console.log('command listener opened in background')
browser.commands.onCommand.addListener((command) => {
  console.log('command received on the background:', command)
})
