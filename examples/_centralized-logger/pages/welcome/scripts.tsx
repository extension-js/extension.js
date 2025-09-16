import {useEffect, useState} from 'react'
import ReactDOM from 'react-dom/client'
import {Button} from '@/components/ui/button'
import {cn, applyTheme} from '@/lib/utils'
import {getDevExtension} from '@/background/define-initial-tab'
import logo from '@/images/logo.png'

import '../../shared/styles.css'

applyTheme()

function getBrowserExtensionType() {
  const browser = import.meta.env.EXTENSION_BROWSER

  switch (browser) {
    case 'chrome':
      return 'Chrome Extension'
    case 'edge':
      return 'Edge Add-on'
    case 'firefox':
      return 'Firefox Add-on'
    default:
      return 'Extension'
  }
}

async function onStartup(
  setExtension: (extension: chrome.management.ExtensionInfo) => void,
  setDescription: (description: string) => void
) {
  const userExtensions = await getDevExtension()

  if (userExtensions) {
    setExtension(userExtensions)
    setDescription(userExtensions.description)
  }
}

const Welcome: React.FC = () => {
  const [extension, setExtension] =
    useState<chrome.management.ExtensionInfo | null>(null)
  const [description, setDescription] = useState<string>('')

  useEffect(() => {
    onStartup(setExtension, setDescription)
  }, [])

  const handleLearnMore = () => {
    chrome.tabs.create({url: 'https://extension.js.org/'})
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-screen dark:bg-muted'
      )}
    >
      <header className="mb-4 flex gap-2">
        <img className="size-24" alt="Extension.js logo" src={logo} />
        {/* <h2 className="text-center text-lg font-semibold tracking-tight">
          Extension.js presents
        </h2> */}
      </header>
      <h1 className="mx-auto text-center text-5xl lg:text-6xl xl:text-7xl font-bold lg:tracking-tight xl:tracking-tighter">
        {/* <h1 className="mx-auto text-center max-w-3xl text-center text-7xl font-bold tracking-tighter"> */}
        {getBrowserExtensionType()}
        <br />
        <a href="#">
          <span
            id="extensionName"
            title={
              extension
                ? `• Name: ${extension.name}
• ID: ${extension.id}
• Version: ${extension.version}`
                : ''
            }
          >
            {/* {extension ? extension.name : ''}
            <br /> */}
            ready for development
          </span>
        </a>
      </h1>
      {/* <p className="text-lg mt-3 text-muted-foreground max-w-xl mx-auto text-center">
        <span id="extensionDescription">{description}</span>
      </p> */}
      <p className="text-lg mt-3 text-muted-foreground max-w-xl mx-auto text-center">
        <a
          target="_blank"
          href="https://extension.js.org"
          rel="noopener noreferrer"
        >
          Extension.js
        </a>{' '}
        is a development toolkit for building
        <br />
        cross-browser extensions with modern web technologies.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Button onClick={handleLearnMore}>
          🧩 Learn more about developing cross-browser extensions
        </Button>
      </div>
    </div>
  )
}

// React mount code
const rootElement = document.getElementById('root')
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(<Welcome />)
}
