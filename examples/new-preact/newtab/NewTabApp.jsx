import {Component} from 'preact'
import 'sakura.css'
import './styles.css'
import Logo from './logo'

export default class NewTabApp extends Component {
  render() {
    return (
      <header>
        <h1>
          <Logo height="120px" title="The Preact logo" inverted />
          <br />
          Welcome to your Preact Extension.
        </h1>
        <p>
          Learn more about creating browser extensions at{' '}
          <a href="https://extension.js.org" target="_blank">
            https://extension.js.org
          </a>
          .
        </p>
      </header>
    )
  }
}
