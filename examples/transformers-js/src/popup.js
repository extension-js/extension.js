// popup.js - handles interaction with the extension's popup, sends requests to the
// service worker (background.js), and updates the popup's UI (popup.html) on completion.

import {ACTION_NAME} from './constants.js'

const inputElement = document.getElementById('text')
const outputElement = document.getElementById('output')

// Listen for changes made to the textbox.
inputElement.addEventListener('input', async (event) => {
  // Bundle the input data into a message.
  const message = {
    action: ACTION_NAME,
    text: event.target.value
  }

  // Send this message to the service worker.
  const response = await chrome.runtime.sendMessage(message)

  // Handle results returned by the service worker (`background.js`) and update the popup's UI.
  outputElement.innerText = JSON.stringify(response, null, 2)
})
