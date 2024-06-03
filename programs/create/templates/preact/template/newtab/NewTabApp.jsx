import { Component } from "preact";
import "sakura.css";
import "./base.css";
import preactLogo from "../public/preact.png";

export default class NewTabApp extends Component {
  render() {
    return (
      <header>
        <h1>
          <img
            class="preact"
            src={preactLogo}
            alt="The Preact logo"
            width="120px"
          />
          <br />
          Welcome to your Preact Extension.
        </h1>
        <p>
          Learn more about creating browser extensions at{" "}
          <a href="https://extension.js.org" target="_blank">
            https://extension.js.org
          </a>
          .
        </p>
      </header>
    );
  }
}
