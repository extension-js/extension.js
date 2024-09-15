import jsLogo from '../public/logo.png'
import extensionJsLogo from '../images/extension_128.png'

const contentComponent = `<div class="content_script-box">
  <div class="content_script-header">
    <img class="content_script-logo" src=${jsLogo} />
    <span>+</span>
    <img class="content_script-logo" src=${extensionJsLogo} />
  </div>
  <h1 class="content_script-title">
    Change the background-color ⬇
  </h1>
  <input type="color" class="content_script-colorPicker" id="colorPicker">
  <p class="content_script-description">
    Learn more about creating browser extensions at <a
      className="underline hover:no-underline"
      href="https://extension.js.org"
      target="_blank"
    >
    https://extension.js.org
    </a>
  </p>
</div>`

export {contentComponent}
