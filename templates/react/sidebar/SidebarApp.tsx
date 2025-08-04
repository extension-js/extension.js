import './styles.css'
import reactLogo from '../images/react.png'

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
          This sidebar panel runs in the browser's sidebar.
          <br />
          Learn more about creating cross-browser extensions at{' '}
          <a
            href="https://extension.js.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 transition-colors duration-200"
          >
            https://extension.js.org
          </a>
          .
        </p>
      </header>
    </div>
  )
}
