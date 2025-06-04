import React from 'react'
import reactLogo from '../images/react.png'

export default function SidebarApp() {
  return (
    <div className="p-4 bg-white dark:bg-gray-900 min-h-screen">
      <header className="text-center">
        <h1 className="mb-4 text-2xl font-bold text-gray-900 dark:text-white">
          <img
            className="mx-auto mb-2 w-32 animate-spin-slow"
            src={reactLogo}
            alt="The React logo"
            width="120"
          />
          <br />
          Welcome to your React Extension
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
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
