import './styles.css'
import logo from '../images/logo.png'

console.log(
  'hello from content_scripts',
  process.env.EXTENSION_PUBLIC_DESCRIPTION_TEXT
)

if (document.readyState === 'complete') {
  initial()
} else {
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') initial()
  })
}

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
      <p class="content_description">${process.env.EXTENSION_PUBLIC_DESCRIPTION_TEXT}</p>
      <h1 class="content_title">
        Welcome to your .env Extension
      </h1>
      <p class="content_description">
        Learn more about creating cross-browser extensions at <a
          class="underline hover:no-underline"
          href="https://extension.js.org"
          target="_blank"
        >
        https://extension.js.org
        </a>
      </p>
    </div>
  `
}
