/**
 * Content Script for Custom Font Example
 *
 * This example demonstrates how to properly load and use custom fonts
 * in browser extensions with Tailwind CSS.
 *
 * Key points:
 * 1. Font files must be in public/fonts/ directory
 * 2. Web accessible resources must be configured in manifest.json
 * 3. Font-face declarations must use correct paths
 * 4. Tailwind classes can be used with custom font families
 */

// Create the content script element
function createContentScript() {
  const container = document.createElement('div')
  container.className = 'content_script'

  container.innerHTML = `
    <h2 class="text-xl font-bold mb-4 text-gray-800">Custom Font Demo</h2>
    
    <div class="font_demo font_roboto">
      <h3>Roboto (Sans-serif)</h3>
      <p class="text-sm">This text uses Roboto font family. Perfect for body text, UI elements, and general content. Roboto is a clean, modern sans-serif font.</p>
    </div>
    
    <div class="font_demo font_source_code_pro">
      <h3>Source Code Pro (Monospace)</h3>
      <p class="text-sm">This text uses Source Code Pro font family. Great for code snippets, technical content, and monospace requirements. Perfect for displaying code.</p>
    </div>
    
    <div class="mt-4 p-3 bg-gray-100 rounded-lg">
      <h4 class="font-semibold text-gray-700 mb-2">Font Families Used:</h4>
      <ul class="text-xs text-gray-600 space-y-1">
        <li>• <code>Roboto</code> - Clean sans-serif for UI and body text</li>
        <li>• <code>Source Code Pro</code> - Monospace for code and technical content</li>
      </ul>
    </div>
    
    <div class="mt-4 p-3 bg-blue-50 rounded-lg">
      <h4 class="font-semibold text-blue-700 mb-2">Setup Instructions:</h4>
      <ol class="text-xs text-blue-600 space-y-1">
        <li>1. Place font files in <code>public/fonts/</code> directory</li>
        <li>2. Add font patterns to <code>web_accessible_resources</code> in manifest.json</li>
        <li>3. Declare <code>@font-face</code> rules in your CSS</li>
        <li>4. Use CSS classes like <code>font_roboto</code> in your HTML</li>
      </ol>
    </div>
  `

  return container
}

// Initialize the content script
function init() {
  // Check if content script is already injected
  if (document.querySelector('.content_script')) {
    return
  }

  const contentScript = createContentScript()
  document.body.appendChild(contentScript)

  // Add click handler to close the demo
  contentScript.addEventListener('click', (e) => {
    if (e.target === contentScript) {
      contentScript.remove()
    }
  })

  console.log('Custom Font Demo: Content script loaded successfully!')
  console.log('Font families available:', ['Roboto', 'Source Code Pro'])
}

// Run initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
