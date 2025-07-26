import {log} from '@extension/base/services/logger'

browser.browserAction.onClicked.addListener((tab) => {
  if (tab.id) {
    log('Hello Console')
  }
})
