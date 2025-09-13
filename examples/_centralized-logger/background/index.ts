import {initManagerUI} from './manager-ui'
// import {connect, disconnect, keepAlive} from './reload-service'

chrome.runtime.onStartup.addListener(async () => {
  await initManagerUI()
})

chrome.runtime.onInstalled.addListener(async () => {
  let isConnected = false

  await initManagerUI()

  // if (isConnected) {
  //   disconnect()
  // } else {
  //   await connect()
  //   isConnected = true
  //   keepAlive()
  // }
})
