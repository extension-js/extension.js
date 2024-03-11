import React from 'react'
import reactLogo from '../images/react.png'

export default function NewTabApp() {
  return (
    <div>
      <header>
        <h1>
          <img src={reactLogo} className="rotate" alt="The React logo" width="120px" />
          <br />
          Welcome to your React Extension.
        </h1>
        <p>
          Learn more about creating browser extensions at{' '}
          <a href="https://docs.extensioncreate.com" target="_blank">
            https://docs.extensioncreate.com
          </a>
          .
        </p>
      </header>
    </div>
  )
}
