import logo from '../images/logo.png'

const contentComponent = `<div class="content_script">
  <img class="content_logo" src="${logo}" />
  <h1 class="content_title">Welcome to your ESModule Extension</h1>
  <p class="content_description">
    Learn more about creating cross-browser extensions at <a
      className="underline hover:no-underline"
      href="https://extension.js.org"
      target="_blank"
    >
    https://extension.js.org
    </a>
  </p>
</div>`

export {contentComponent}
