import './styles.css'
import iconUrl from '../images/icon.png'

const javascriptLogo = iconUrl

function SidebarApp() {
  const root = document.getElementById('root')
  if (!root) return

  root.innerHTML = `
    <div class="sidebar_app">
      <img
        class="sidebar_logo"
        src="${javascriptLogo}"
        alt="The JavaScript logo"
      />
      <h1 class="sidebar_title">Sidebar Panel</h1>
      <p class="sidebar_description">
        Learn more in the
        <a
          href="https://extension.js.org"
          target="_blank" rel="noopener noreferrer"
        >Extension.js docs</a>
        .
      </p>
    </div>
  `
}

SidebarApp()
