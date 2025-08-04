import logo from '../images/preact.png'
import './styles.css'

export default function SidebarApp() {
  return (
    <div className="sidebar_app">
      <img className="sidebar_logo" src={logo} alt="The Preact logo" />
      <h1 className="sidebar_title">
        Sidebar Panel
        <br />
        Preact Extension
      </h1>
      <p className="sidebar_description">
        This sidebar panel runs in the browser's sidebar.
        <br />
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
