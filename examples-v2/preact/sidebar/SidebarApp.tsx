import {h} from 'preact'
import preactLogo from '../images/preact.png'
import './styles.css'

export default function SidebarApp() {
  return (
    <div className="p-4">
      <header className="text-center">
        <h1 className="mb-4">
          <img
            className="preact mx-auto mb-2"
            src={preactLogo}
            alt="The Preact logo"
            width="120px"
          />
          <br />
          Welcome to your Preact Extension
        </h1>
        <p className="text-gray-600">
          Learn more about creating cross-browser extensions at{' '}
          <a
            href="https://extension.js.org"
            target="_blank"
            className="text-blue-600 hover:underline"
          >
            https://extension.js.org
          </a>
          .
        </p>
      </header>
    </div>
  )
}
