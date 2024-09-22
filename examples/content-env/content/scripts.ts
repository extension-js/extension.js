import './styles.css'
import logo from '../images/logo.png'

console.log(
  'hello from content_scripts',
  process.env.EXTENSION_PUBLIC_DESCRIPTION_TEXT
)

// Check if the content has already been added
document.body.innerHTML += `
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
