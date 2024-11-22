import './styles.css'
import logo from '../images/extension.svg'

console.log('hello from content_scripts')

setTimeout(initial, 1000)

function initial() {
  const rootDiv = document.createElement('div')
  rootDiv.id = 'extension-root'
  document.body.appendChild(rootDiv)

  // Injecting content_scripts inside a shadow dom
  // prevents conflicts with the host page's styles.
  // This way, styles from the extension won't leak into the host page.
  const shadowRoot = rootDiv.attachShadow({mode: 'open'})

  if (process.env.EXTENSION_MODE === 'development') {
    // Use the shadow root as the root element to inject styles into.
    window.__EXTENSION_SHADOW_ROOT__ = shadowRoot
  }

  shadowRoot.innerHTML = `
    <div class="content_script">
      <img class="content_logo" src="${logo}" />
      <h1 class="content_title">
        Main World
      </h1>
      <p class="content_description">
        Learn more about creating cross-browser extensions at <a
          className="underline hover:no-underline"
          href="https://extension.js.org"
          target="_blank"
        >
        https://extension.js.org
        </a>
      </p>
    </div>
  `
}
