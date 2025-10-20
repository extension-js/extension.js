import typescriptLogo from '../images/logo.svg'

function SidebarApp() {
  const root = document.getElementById('root')
  if (!root) return

  root.innerHTML = `
    <div class="sidebar_app">
      <img
        class="sidebar_logo"
        src="${typescriptLogo}"
        alt="The TypeScript logo"
      />
      <h1 class="sidebar_title">Sidebar Panel</h1>
      <p class="sidebar_description">
        Learn more about creating cross-browser extensions at
        <a
          href="https://extension.js.org"
          target="_blank"
        >
          https://extension.js.org
        </a>
        .
      </p>
    </div>
  `
}

SidebarApp()
