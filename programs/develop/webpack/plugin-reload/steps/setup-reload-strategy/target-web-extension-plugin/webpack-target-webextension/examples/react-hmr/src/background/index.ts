import browser from 'webextension-polyfill'
import { Clear, isGetAll, isMessage, Message } from '../utils/index.ts'

const messages: string[] = []
const init = browser.storage.local.get('messages').then((result) => {
  if (Array.isArray(result.messages) && result.messages.every((item) => typeof item === 'string')) {
    messages.push(...result.messages)
  }
})

browser.runtime.onMessage.addListener(async (message) => {
  await init
  if (isMessage(message)) {
    let response: Message | Clear
    if (message.content === '/clear') {
      messages.length = 0
      response = { type: 'clear' }
    } else {
      messages.push(message.content)
      response = { type: 'message', content: message.content }
    }
    ;(await browser.tabs.query({})).forEach((tab) => {
      browser.tabs.sendMessage(tab.id, response)
    })
    await browser.storage.local.set({ messages })
  } else if (isGetAll(message)) {
    return { type: 'get_all_resp', messages }
  }
})
