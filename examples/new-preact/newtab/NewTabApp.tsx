import 'sakura.css'
import './styles.css'
import preactLogo from '../images/preact.png'

export default function ContentApp() {
  return (
    <header>
      <h1>
        <img
          className="preact"
          src={preactLogo}
          alt="The Preact logo"
          width="120px"
        />
        <br />
        Welcome to your Preact Extension.
      </h1>
      <p>
        Learn more about creating cross-browser extensions at{' '}
        <a href="https://extension.js.org" target="_blank">
          https://extension.js.org
        </a>
        .
      </p>
    </header>
  )
}
