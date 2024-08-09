import React from 'react'
import reactLogo from '../images/react.png'
import tailwindLogo from '../images/tailwind.png'
import chromeWindowBg from '../images/chromeWindow.png'

export default function NewTabApp() {
  return (
    <div className="h-[100vh] items-center relative isolate overflow-hidden bg-gray-900 shadow-2xl sm:px-16 md:pt-24 lg:flex lg:gap-x-20 lg:px-24 lg:pt-0">
      <svg
        viewBox="0 0 1024 1024"
        className="absolute left-1/2 top-1/2 -z-10 h-[64rem] w-[64rem] -translate-y-1/2 [mask-image:radial-gradient(closest-side,white,transparent)] sm:left-full sm:-ml-80 lg:left-1/2 lg:ml-0 lg:-translate-x-1/2 lg:translate-y-0"
        aria-hidden="true"
      >
        <circle
          cx="512"
          cy="512"
          r="512"
          fill="url(#759c1415-0410-454c-8f7c-9a820de03641)"
          fillOpacity="0.7"
        />
        <defs>
          <radialGradient id="759c1415-0410-454c-8f7c-9a820de03641">
            <stop stopColor="#6de935" />
            <stop offset="1" stopColor="#75d682" />
          </radialGradient>
        </defs>
      </svg>
      <div className="mx-auto max-w-md text-center lg:mx-0 lg:flex-auto lg:py-32 lg:text-left">
        <div className="flex items-center justify-center lg:justify-start space-x-4 mx-auto mt-10 mb-4">
          <img
            alt="React logo"
            src={reactLogo}
            className="relative inline-block w-12"
          />
          <div className="text-3xl text-white">+</div>
          <img
            alt="Tailwind logo"
            src={tailwindLogo}
            className="relative inline-block w-12"
          />
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          This is a new tab page running React and Tailwind.css.
        </h2>
        <p className="mt-6 text-lg leading-8 text-gray-300">
          Learn more about creating browser extensions at{' '}
          <a
            className="underline hover:no-underline"
            href="https://extension.js.org"
            target="_blank"
          >
            https://extension.js.org
          </a>
          .
        </p>
      </div>
      <div className="relative mt-16 h-80 lg:mt-8">
        <img
          className="absolute left-0 top-0 w-[57rem] max-w-none rounded-md bg-white/5 ring-1 ring-white/10"
          src={chromeWindowBg}
          alt="Chrome screenshot"
          width="1824"
          height="1080"
        />
      </div>
    </div>
  )
}
