import typescriptLogo from '../images/logo.svg'
import './styles.css'

function SidebarApp() {
  const root = document.getElementById('root')
  if (!root) return

  root.innerHTML = `
    <div class="p-4">
      <header class="text-center">
        <h1 class="mb-4">
          <img
            class="typescript mx-auto mb-2"
            src="${typescriptLogo}"
            alt="The TypeScript logo"
            width="120px"
          />
          <br />
          Welcome to your TypeScript Extension
        </h1>
        <p class="text-gray-600">
          Learn more about creating cross-browser extensions at
          <a
            href="https://extension.js.org"
            target="_blank"
            class="text-blue-600 hover:underline"
          >
            https://extension.js.org
          </a>
          .
        </p>
      </header>
    </div>
  `
}

SidebarApp()
