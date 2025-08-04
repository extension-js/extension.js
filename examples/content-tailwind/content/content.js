import tailwindBg from '../images/tailwind_bg.png'
import tailwindLogo from '../images/tailwind.png'
import chromeWindowBg from '../images/chromeWindow.png'

export function getContentHtml() {
  return `
    <div class="mx-auto max-w-4xl p-6">
      <div class="bg-white rounded-2xl shadow-xl p-8">
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold text-gray-900 mb-2 font_inter">
            Google Fonts with Tailwind CSS v4
          </h1>
          <p class="text-gray-600 font_open_sans">
            This content script demonstrates Google Fonts in browser extensions
          </p>
        </div>
        
        <div class="grid gap-6">
          <div class="font_demo font_inter">
            <h3 class="text-lg font-semibold mb-2">Inter (Sans-serif)</h3>
            <p class="text-gray-700">
              This text uses Inter font family. Perfect for modern web applications, 
              clean typography, and excellent readability. Inter is designed specifically 
              for computer screens.
            </p>
          </div>
          
          <div class="font_demo font_roboto_mono">
            <h3 class="text-lg font-semibold mb-2">Roboto Mono (Monospace)</h3>
            <p class="text-gray-700">
              This text uses Roboto Mono font family. Great for code snippets, 
              technical content, and monospace requirements. Perfect for displaying 
              code or technical information.
            </p>
          </div>
          
          <div class="font_demo font_poppins">
            <h3 class="text-lg font-semibold mb-2">Poppins (Sans-serif)</h3>
            <p class="text-gray-700">
              This text uses Poppins font family. Excellent for headings, UI elements, 
              and modern design. Poppins is a geometric sans-serif typeface with 
              great personality.
            </p>
          </div>
          
          <div class="font_demo font_open_sans">
            <h3 class="text-lg font-semibold mb-2">Open Sans (Sans-serif)</h3>
            <p class="text-gray-700">
              This text uses Open Sans font family. Perfect for body text, long-form 
              content, and general readability. Open Sans is optimized for legibility 
              across all screen sizes.
            </p>
          </div>
        </div>
        
        <div class="mt-8 p-4 bg-gray-50 rounded-lg">
          <h4 class="font-semibold text-gray-800 mb-3">How it works:</h4>
          <ul class="text-sm text-gray-600 space-y-1 font_open_sans">
            <li>• Google Fonts are loaded via CDN using <code>@import url()</code></li>
            <li>• No local font files or manifest configuration needed</li>
            <li>• Fonts work immediately across all websites</li>
            <li>• Optimized for web performance and caching</li>
          </ul>
        </div>
      </div>
    </div>
  `
}
