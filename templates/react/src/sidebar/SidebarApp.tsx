import './styles.css'
import iconUrl from '../images/icon.png'

const reactLogo = iconUrl

export default function SidebarApp() {
  return (
    <div className="sidebar_app">
      <header>
        <img
          className="sidebar_logo"
          src={reactLogo}
          alt="The React logo"
          width="120"
        />
        <h1 className="sidebar_title">Sidebar Panel</h1>
        <p className="sidebar_description">
          Learn more in the{' '}
          <a
            href="https://extension.js.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 transition-colors duration-200"
          >
            Extension.js docs
          </a>
          .
        </p>
      </header>
    </div>
  )
}
