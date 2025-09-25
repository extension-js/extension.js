// Extension.js content script template (Transformers.js parity version)
// - Exports a default function that mounts your UI inside a Shadow DOM
// - Handles style isolation, CSS injection, and cleanup
// Docs: https://extension.js.org/docs/content-scripts
import transformersLogo from '../images/extension_48.png'
import {ACTION_NAME} from '../constants.js'

export default function contentScript() {
  // Create a new div element and append it to the document's body
  const rootDiv = document.createElement('div')
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  const styleElement = document.createElement('style')
  shadowRoot.appendChild(styleElement)
  fetchCSS().then((response) => (styleElement.textContent = response))

  // Create container for JavaScript app
  const container = document.createElement('div')
  container.className = 'content_script'
  shadowRoot.appendChild(container)

  // Create and append logo image
  const img = document.createElement('img')
  img.className = 'content_logo'
  img.src = transformersLogo
  img.alt = 'Transformers.js Logo'
  container.appendChild(img)

  // Create and append title
  const title = document.createElement('h1')
  title.className = 'content_title'
  title.textContent = 'Transformers.js'
  container.appendChild(title)

  // Create and append description paragraph
  const desc = document.createElement('p')
  desc.className = 'content_description'
  desc.innerHTML =
    'AI-powered text analysis running in your browser.<br />Click the extension icon to open the sidebar and try sentiment analysis.'
  container.appendChild(desc)

  // Create classification button
  const classifyBtn = document.createElement('button')
  classifyBtn.className = 'content_classify_btn'
  classifyBtn.textContent = 'Classify Selected Text'
  classifyBtn.onclick = async () => {
    const selectedText = window.getSelection().toString().trim()

    if (!selectedText) {
      showMessage('Please select some text first!', 'warning')
      return
    }

    if (selectedText.length < 3) {
      showMessage('Please select more text for better results.', 'warning')
      return
    }

    try {
      showMessage('Analyzing...', 'loading')
      const message = {
        action: ACTION_NAME,
        text: selectedText
      }
      const response = await chrome.runtime.sendMessage(message)

      if (response && response.length > 0) {
        const result = response[0]
        const confidence = (result.score * 100).toFixed(1)
        showMessage(`${result.label} (${confidence}% confidence)`, 'success')
      } else {
        showMessage('Analysis failed. Please try again.', 'error')
      }
    } catch (error) {
      showMessage('Error: ' + error.message, 'error')
    }
  }
  container.appendChild(classifyBtn)

  // Create message area for results
  const messageArea = document.createElement('div')
  messageArea.className = 'content_message'
  container.appendChild(messageArea)

  // Helper function to show messages
  function showMessage(text, type = 'info') {
    messageArea.textContent = text
    messageArea.className = `content_message content_message--${type}`

    if (type !== 'loading') {
      setTimeout(() => {
        messageArea.textContent = ''
        messageArea.className = 'content_message'
      }, 4000)
    }
  }

  // Return cleanup function for unmounting (required)
  return () => {
    rootDiv.remove()
  }
}

async function fetchCSS() {
  const cssUrl = new URL('./styles.css', import.meta.url)
  const response = await fetch(cssUrl)
  const text = await response.text()
  return response.ok ? text : Promise.reject(text)
}
