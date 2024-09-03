import extensionJsLogo from '../images/extension_128.png'
import './styles.css'

document.body.innerHTML += `
<div class="content_script-box">
  <img class="content_script-logo" src=${extensionJsLogo} />
  <h1 class="content_script-title">
    Main World
  </h1>
  <p class="content_script-description">
    Learn more about creating browser extensions at <a
      className="underline hover:no-underline"
      href="https://extension.js.org"
      target="_blank"
    >
    https://extension.js.org
    </a>
  </p>
</div>
`
