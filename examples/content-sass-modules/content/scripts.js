import './styles.scss'
import styles from './Logo.module.scss'
import logo from '../images/logo.svg'

console.log('hello from content_scripts')

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

  // Inform Extension.js that the shadow root is available.
  window.__EXTENSION_SHADOW_ROOT__ = shadowRoot

  shadowRoot.innerHTML = `
    <div class="content_script">
      <img class="${styles.logo}" src="${logo}" />
      <h1 class="content_title">
        Welcome to your Sass Modules Extension
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
