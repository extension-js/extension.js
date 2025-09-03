// The directive below tells Extension.js to inject the content
// script of this file into the shadow DOM of the host page and
// inject all CSS imports into it. This provides style isolation
// and prevents conflicts with the host page's styles.
// See https://extension.js.org/docs/content-scripts#use-shadow-dom
'use shadow-dom'

import transformersLogo from '../images/extension_48.png'
import {ACTION_NAME} from '../constants.js'
import './styles.css'

/**
 * @typedef {Object} ContentScriptOptions
 * @property {string} [rootElement] - The root element ID
 * @property {string} [rootClassName] - The root element class name
 */
export default function contentScript(options = {}) {
  return (container) => {
    // Create content wrapper div
    const contentDiv = document.createElement('div')
    contentDiv.className = 'content_script'

    // Create and append logo image
    const img = document.createElement('img')
    img.className = 'content_logo'
    img.src = transformersLogo
    img.alt = 'Transformers.js Logo'
    contentDiv.appendChild(img)

    // Create and append title
    const title = document.createElement('h1')
    title.className = 'content_title'
    title.textContent = 'Transformers.js'
    contentDiv.appendChild(title)

    // Create and append description paragraph
    const desc = document.createElement('p')
    desc.className = 'content_description'
    desc.innerHTML =
      'AI-powered text analysis running in your browser.<br />Click the extension icon to open the sidebar and try sentiment analysis.'

    contentDiv.appendChild(desc)

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
    contentDiv.appendChild(classifyBtn)

    // Create message area for results
    const messageArea = document.createElement('div')
    messageArea.className = 'content_message'
    contentDiv.appendChild(messageArea)

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

    // Append content div to container
    container.appendChild(contentDiv)

    // Return cleanup function for unmounting (required)
    return () => {
      container.innerHTML = ''
    }
  }
}
