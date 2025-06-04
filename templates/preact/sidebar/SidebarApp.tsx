import logo from '../images/preact.png'
import './styles.css'

export default function SidebarApp() {
  return (
    <div class="sidebar_app">
      <img class="sidebar_logo" src={logo} alt="The Preact logo" />
      <h1 class="sidebar_title">
        Welcome to your
        <br />
        Preact Extension
      </h1>
      <p class="sidebar_description">
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
