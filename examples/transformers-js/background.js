// background.js - Handles requests from the UI, runs the model, then sends back a response

import {env, pipeline} from '@huggingface/transformers'
import {CONTEXT_MENU_ITEM_ID} from './constants.js'

console.log('Transformers.js background script loaded!')

// Browser compatibility handling for sidebar functionality
const isFirefoxLike =
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'firefox' ||
  import.meta.env.EXTENSION_PUBLIC_BROWSER === 'gecko-based'

if (isFirefoxLike) {
  browser.browserAction.onClicked.addListener(() => {
    browser.sidebarAction.open()
  })
} else {
  chrome.action.onClicked.addListener(() => {
    chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})
  })
}

// If you'd like to use a local model instead of loading the model
// from the Hugging Face Hub, you can remove this line.
env.allowLocalModels = false

// A config-aware model manager that caches pipelines per configuration
function configKey(cfg) {
  const safe = {
    task: cfg.task,
    model: cfg.model,
    device: cfg.device,
    dtype: cfg.dtype
  }
  return JSON.stringify(safe)
}

class ModelManager {
  constructor() {
    this.cache = new Map()
    this.currentKey = null
    this.currentConfig = null
    this.ready = this.loadInitial()
    chrome.storage.onChanged.addListener(this.onStorageChanged.bind(this))
  }

  async loadInitial() {
    const {modelConfig} = await chrome.storage.sync.get('modelConfig')
    this.currentConfig = modelConfig || {
      task: 'text-classification',
      model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
      device: 'webgpu',
      dtype: 'q4'
    }
    this.currentKey = configKey(this.currentConfig)
  }

  onStorageChanged(changes, area) {
    if (area !== 'sync' || !changes.modelConfig) return
    this.currentConfig = changes.modelConfig.newValue
    this.currentKey = configKey(this.currentConfig)
    // Lazy rebuild: next call uses the new key; cache retains previous instance
  }

  async getRunner(progress_callback) {
    await this.ready
    const key = this.currentKey
    const cfg = this.currentConfig

    if (!this.cache.has(key)) {
      const entry = {}
      entry.fn = async (...args) => {
        entry.instance ||= pipeline(cfg.task, cfg.model, {
          progress_callback,
          device: cfg.device,
          dtype: cfg.dtype
        })
        return (entry.promise_chain = (
          entry.promise_chain || Promise.resolve()
        ).then(async () => {
          const runner = await entry.instance
          return runner(...args)
        }))
      }
      this.cache.set(key, entry)
    }
    return this.cache.get(key).fn
  }
}

const models = new ModelManager()

const classify = async (text) => {
  const runner = await models.getRunner((data) => {
    // Optionally forward progress to UI
    // console.log('progress', data)
  })
  return runner(text)
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
  if (message.action === 'classify') {
    ;(async function () {
      try {
        const result = await classify(message.text)
        sendResponse(result)
      } catch (e) {
        sendResponse({error: e?.message || 'classification failed'})
      }
    })()
    return true
  }

  if (message.action === 'model-config-updated') {
    // Storage listener already updates; acknowledge for UI
    sendResponse({ok: true})
    return
  }
})
//////////////////////////////////////////////////////////////
