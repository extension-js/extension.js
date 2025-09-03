// background.js - Handles requests from the UI, runs the model, then sends back a response

import {env, pipeline} from '@huggingface/transformers'

import {CONTEXT_MENU_ITEM_ID} from './constants.js'

// If you'd like to use a local model instead of loading the model
// from the Hugging Face Hub, you can remove this line.
env.allowLocalModels = false

/**
 * Wrap the pipeline construction in a Singleton class to ensure:
 * (1) the pipeline is only loaded once, and
 * (2) the pipeline can be loaded lazily (only when needed).
 */
class Singleton {
  static async getInstance(progress_callback) {
    // Return a function which does the following:
    // - Load the pipeline if it hasn't been loaded yet
    // - Run the pipeline, waiting for previous executions to finish if needed
    return (this.fn ??= async (...args) => {
      this.instance ??= pipeline(
        'text-classification',
        'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
        {
          progress_callback,
          device: 'webgpu',
          dtype: 'q4'
        }
      )

      return (this.promise_chain = (
        this.promise_chain ?? Promise.resolve()
      ).then(async () => (await this.instance)(...args)))
    })
  }
}

// Create generic classify function, which will be reused for the different types of events.
const classify = async (text) => {
  // Get the pipeline instance. This will load and build the model when run for the first time.
  const classifier = await Singleton.getInstance((data) => {
    // You can track the progress of the pipeline creation here.
    // e.g., you can send `data` back to the UI to indicate a progress bar
    // console.log(data)
  })

  // Run the model on the input text
  const result = await classifier(text)
  return result
}

////////////////////// 1. Context Menus //////////////////////
//
// Add a listener to create the initial context menu items,
// context menu items only need to be created at runtime.onInstalled
chrome.runtime.onInstalled.addListener(function () {
  // Register a context menu item that will only show up for selection text.
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ITEM_ID,
    title: 'Classify "%s"',
    contexts: ['selection']
  })
})

// Perform inference when the user clicks a context menu
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Ignore context menu clicks that are not for classifications (or when there is no input)
  if (info.menuItemId !== CONTEXT_MENU_ITEM_ID || !info.selectionText) return

  // Perform classification on the selected text
  const result = await classify(info.selectionText)

  // Do something with the result
  chrome.scripting.executeScript({
    target: {tabId: tab.id}, // Run in the tab that the user clicked in
    args: [result], // The arguments to pass to the function
    function: (result) => {
      // The function to run
      // NOTE: This function is run in the context of the web page, meaning that `document` is available.
      console.log('result', result)
      console.log('document', document)
    }
  })
})
//////////////////////////////////////////////////////////////

////////////////////// 2. Message Events /////////////////////
//
// Listen for messages from the UI, process it, and send the result back.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'classify')
    return // Ignore messages that are not meant for classification.
    // Run model prediction asynchronously
  ;(async function () {
    // Perform classification
    const result = await classify(message.text)

    // Send response back to UI
    sendResponse(result)
  })()

  // return true to indicate we will send a response asynchronously
  // see https://stackoverflow.com/a/46628145 for more information
  return true
})
//////////////////////////////////////////////////////////////
