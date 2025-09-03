import transformersLogo from '../images/extension_48.png'
import {ACTION_NAME} from '../constants.js'
import './styles.css'

const DEFAULTS = {
  task: 'text-classification',
  model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  device: 'webgpu',
  dtype: 'q4'
}

const MODELS = {
  'text-classification': [
    'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    'Xenova/mobilebert-uncased-mnli'
  ],
  'token-classification': ['Xenova/bert-base-cased-finetuned-conll03-english'],
  'question-answering': ['Xenova/distilbert-base-cased-distilled-squad'],
  'text-generation': ['Xenova/tiny-stories-1M']
}

function SidebarApp() {
  const root = document.getElementById('root')
  if (!root) return

  root.innerHTML = `
    <div class="sidebar_app">
      <img
        class="sidebar_logo"
        src="${transformersLogo}"
        alt="The Transformers.js logo"
      />
      <h1 class="sidebar_title" id="title">Transformers.js Sidebar Panel</h1>
      <p class="sidebar_description">
        AI-powered sentiment analysis running in your browser.
        <br />
        Learn more about creating cross-browser extensions at
        <a
          href="https://extension.js.org"
          target="_blank"
        >
          https://extension.js.org
        </a>
      </p>
      
      <div class="sidebar_config_section">
        <h3 class="sidebar_output_title">Model Settings</h3>
        <div class="sidebar_input_section">
          <label class="sidebar_label" for="task">Task</label>
          <select id="task"></select>
        </div>
        <div class="sidebar_input_section">
          <label class="sidebar_label" for="model">Model</label>
          <select id="model"></select>
        </div>
        <div class="sidebar_input_section">
          <label class="sidebar_label" for="customModel">Custom model (optional)</label>
          <input id="customModel" placeholder="org/model-id" />
        </div>
        <div class="sidebar_input_section">
          <label class="sidebar_label" for="device">Device</label>
          <select id="device">
            <option value="webgpu">webgpu</option>
            <option value="webgl">webgl</option>
            <option value="cpu">cpu</option>
          </select>
        </div>
        <div class="sidebar_input_section">
          <label class="sidebar_label" for="dtype">Precision</label>
          <select id="dtype">
            <option value="q4">q4</option>
            <option value="q8">q8</option>
            <option value="fp32">fp32</option>
          </select>
        </div>
      </div>
      
      <div class="sidebar_input_section">
        <label for="text-input" class="sidebar_label">
          Enter text for sentiment analysis:
        </label>
        <textarea id="text-input" placeholder="Type or paste your text here..." rows="4"></textarea>
        <div class="actions"><button id="run-analysis">Run Analysis</button></div>
      </div>
      
      <div class="sidebar_output_section">
        <h3 class="sidebar_output_title">Analysis Results</h3>
        <div id="output" class="sidebar_output">
          Enter some text above to see the sentiment analysis results.
        </div>
      </div>
    </div>
  `

  // Get elements after rendering
  const inputElement = root.querySelector('#text-input')
  const outputElement = root.querySelector('#output')
  const titleElement = root.querySelector('#title')
  const runBtn = root.querySelector('#run-analysis')
  const taskEl = root.querySelector('#task')
  const modelEl = root.querySelector('#model')
  const customEl = root.querySelector('#customModel')
  const deviceEl = root.querySelector('#device')
  const dtypeEl = root.querySelector('#dtype')

  // Show active model in title (if available)
  chrome.storage.sync.get('modelConfig').then(({modelConfig}) => {
    if (modelConfig?.model && titleElement) {
      titleElement.textContent = `Transformers.js (${modelConfig.model})`
    }
  })

  // Populate task and model selects
  function populateTasks() {
    taskEl.innerHTML = Object.keys(MODELS)
      .map((t) => `<option value="${t}">${t}</option>`)
      .join('')
  }

  function populateModels(taskValue, selected) {
    modelEl.innerHTML = MODELS[taskValue]
      .map((m) => `<option value="${m}">${m}</option>`)
      .join('')
    if (selected && MODELS[taskValue].includes(selected))
      modelEl.value = selected
  }

  async function loadConfig() {
    populateTasks()
    const {modelConfig} = await chrome.storage.sync.get('modelConfig')
    const cfg = {...DEFAULTS, ...(modelConfig || {})}
    taskEl.value = cfg.task
    populateModels(cfg.task, cfg.model)
    customEl.value = cfg.customModel || ''
    deviceEl.value = cfg.device
    dtypeEl.value = cfg.dtype
  }

  function currentConfig() {
    const task = taskEl.value
    const curated = modelEl.value
    const customModel = customEl.value.trim()
    const model = customModel || curated
    return {
      task,
      model,
      customModel: customModel || undefined,
      device: deviceEl.value,
      dtype: dtypeEl.value
    }
  }

  async function saveConfig() {
    const cfg = currentConfig()
    await chrome.storage.sync.set({modelConfig: cfg})
    if (titleElement && cfg.model) {
      titleElement.textContent = `Transformers.js (${cfg.model})`
    }
    // Notify background (optional, background also listens to storage change)
    chrome.runtime.sendMessage({action: 'model-config-updated', config: cfg})
  }

  // Save on change
  taskEl.addEventListener('change', async () => {
    populateModels(taskEl.value)
    await saveConfig()
  })
  modelEl.addEventListener('change', saveConfig)
  customEl.addEventListener('change', saveConfig)
  deviceEl.addEventListener('change', saveConfig)
  dtypeEl.addEventListener('change', saveConfig)

  loadConfig()

  // Run analysis only when clicking the button
  runBtn.addEventListener('click', async () => {
    const text = inputElement.value.trim()
    if (!text) {
      outputElement.textContent =
        'Enter some text above to see the sentiment analysis results.'
      outputElement.className = 'sidebar_output'
      return
    }
    outputElement.textContent = 'Analyzing sentiment...'
    outputElement.className = 'sidebar_output sidebar_output--loading'
    try {
      await classifyText(text, outputElement)
    } catch (error) {
      showError(error, outputElement)
    }
  })
}

async function classifyText(text, outputElement) {
  try {
    // Bundle the input data into a message
    const message = {
      action: ACTION_NAME,
      text: text
    }

    // Send message to the service worker
    const response = await chrome.runtime.sendMessage(message)

    if (response && response.length > 0) {
      showResults(response, outputElement)
    } else {
      throw new Error('No results received from classification')
    }
  } catch (error) {
    showError(error, outputElement)
  }
}

function showResults(results, outputElement) {
  // Format the results for display
  const formattedResults = results.map((result) => ({
    label: result.label,
    score: (result.score * 100).toFixed(2) + '%',
    confidence:
      result.score > 0.8 ? 'High' : result.score > 0.6 ? 'Medium' : 'Low'
  }))

  const output = {
    results: formattedResults,
    timestamp: new Date().toLocaleTimeString(),
    model: 'DistilBERT (SST-2)'
  }

  outputElement.textContent = JSON.stringify(output, null, 2)
  outputElement.className = 'sidebar_output sidebar_output--success'
}

function showError(error, outputElement) {
  const errorOutput = {
    error: error.message || 'Classification failed',
    timestamp: new Date().toLocaleTimeString(),
    suggestion: 'Try again with different text or check your connection'
  }

  outputElement.textContent = JSON.stringify(errorOutput, null, 2)
  outputElement.className = 'sidebar_output sidebar_output--error'
}

SidebarApp()
