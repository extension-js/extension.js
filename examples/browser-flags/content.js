// Content script for the Browser Flags Example extension

// Log a message when the content script is injected
console.log(
  'Browser Flags Example content script loaded on:',
  window.location.href
)

// Create a visible indicator that the extension is loaded
const indicator = document.createElement('div')
indicator.style.cssText = `
  position: fixed;
  top: 10px;
  right: 10px;
  background: #4CAF50;
  color: white;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: Arial, sans-serif;
  font-size: 12px;
  z-index: 999999;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
`
indicator.textContent = 'Browser Flags Extension Loaded!'
document.body.appendChild(indicator)

// Remove the indicator after 5 seconds
setTimeout(() => {
  if (indicator.parentNode) {
    indicator.parentNode.removeChild(indicator)
  }
}, 5000)

// Since this is just a demo, we're not adding much functionality here
// In a real extension, you might modify the page or interact with the background script

// This example is primarily focused on demonstrating how to customize browser flags
// by using the excludeBrowserFlags option in extension.config.js
