import {h} from 'preact'
import logo from '../images/preact.png'

export default function ContentApp() {
  return (
    <div class="content_script">
      <img class="content_logo" src={logo} alt="Extension Logo" />
      <h1 class="content_title">
        Welcome to your
        <br />
        Preact Extension
      </h1>
      <p class="content_description">
        Learn more about creating cross-browser extensions at{' '}
        <a
          href="https://extension.js.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://extension.js.org
        </a>
      </p>
    </div>
  )
}
