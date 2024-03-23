import React from 'react'
import 'sakura.css'
import './base.css'
import reactLogo from '../public/react.png'

export default function NewTabApp() {
  return (
    <header>
      <h1>
        <img class="react" src={reactLogo} alt="The React logo" width="120px" />
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
  )
}
