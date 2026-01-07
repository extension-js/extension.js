import logo from '../images/preact.png'
import './styles.css'

export default function SidebarApp() {
  return (
    <div className="sidebar_app">
      <img className="sidebar_logo" src={logo} alt="The Preact logo" />
      <h1 className="sidebar_title">Sidebar Panel</h1>
      <p className="sidebar_description">
        Learn more in the{' '}
        <a
          href="https://extension.js.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Extension.js docs
        </a>
        .
      </p>
    </div>
  )
}
