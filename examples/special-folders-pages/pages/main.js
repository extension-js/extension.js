// Simple script to demonstrate that JS files work from the pages folder
console.log('✅ Special Folders - Pages: main.js loaded successfully!')

// Add a timestamp to show the page is interactive
document.addEventListener('DOMContentLoaded', () => {
  const timestamp = new Date().toLocaleTimeString()
  const timestampElement = document.getElementById('timestamp')
  if (timestampElement) {
    timestampElement.textContent = `Loaded at: ${timestamp}`
  }
})
