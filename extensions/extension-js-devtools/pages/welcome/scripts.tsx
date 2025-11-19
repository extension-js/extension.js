import {useEffect, useState} from 'react'
import ReactDOM from 'react-dom/client'
import {Button} from '@/components/ui/button'
import {cn, applyTheme} from '@/lib/utils'
import {getDevExtension} from '@/background/define-initial-tab'
import logo from '@/images/logo.png'

import '@/styles.css'

applyTheme()

async function onStartup(
  setExtension: (extension: chrome.management.ExtensionInfo) => void,
  setDescription: (description: string) => void
) {
  // Try via shared helper first
  const fromBg = await getDevExtension()
  if (fromBg) {
    setExtension(fromBg)
    setDescription(fromBg.description)
    return
  }

  // Fallback: call chrome.management directly in this page context
  const all = (await new Promise((resolve) => {
    try {
      chrome.management.getAll(resolve)
    } catch {
      resolve([])
    }
  })) as chrome.management.ExtensionInfo[]

  const candidates = (all || []).filter((extension) => {
    return (
      extension &&
      extension.installType === 'development' &&
      extension.id !== chrome.runtime.id &&
      extension.enabled &&
      extension.type !== 'theme'
    )
  })

  // Prefer last candidate to align with how we append the user extension last
  const userExtension = candidates.length
    ? candidates[candidates.length - 1]
    : undefined

  if (userExtension) {
    setExtension(userExtension)
    setDescription(userExtension.description)
    return
  }

  // Final fallback: use this extension's manifest for a sensible name
  const manifest = chrome.runtime.getManifest()

  setExtension({
    id: chrome.runtime.id,
    name: manifest?.name || 'Extension',
    shortName: manifest?.short_name,
    description: manifest?.description || '',
    version: manifest?.version || '',
    enabled: true,
    installType: 'development'
  } as chrome.management.ExtensionInfo)

  setDescription(manifest?.description || '')
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

  // Pick the largest available management icon (if any)
  const userIconUrl =
    extension?.icons && extension.icons.length
      ? [...extension.icons].sort((a, b) => (b.size || 0) - (a.size || 0))[0]
          ?.url
      : undefined

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-screen dark:bg-muted'
      )}
    >
      <header className="mb-4 flex items-center gap-2">
        <img className="size-16" alt="Extension.js logo" src={logo} />
        {userIconUrl ? (
          <img
            className="size-16 rounded"
            alt={`${extension?.name || 'User extension'} icon`}
            src={userIconUrl}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : null}
      </header>
      <h1 className="mx-auto text-center text-4xl lg:text-5xl xl:text-6xl font-semibold tracking-tight">
        <span>{extension?.name || 'My Extension'}</span>
        <br />
        <span>is </span>
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
            ready for development
          </span>
        </a>
      </h1>
      <p className="text-lg mt-3 text-muted-foreground max-w-xl mx-auto text-center">
        Extension.js is a development toolkit for building
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
