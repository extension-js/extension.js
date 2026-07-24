// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {useEffect, useState, type HTMLAttributes} from 'react'
import ReactDOM from 'react-dom/client'
import logo from '@/images/logo.png'
import {cn, applyTheme} from '@/lib/utils'
import {getDevExtension} from '@/background/define-initial-tab'
import {ConfirmSetupDialog} from './confirm-setup'

import '@/styles.css'

applyTheme()

type AppFooterProps = HTMLAttributes<HTMLDivElement>

const browser = String(
  // @ts-ignore
  import.meta.env.EXTENSION_BROWSER || 'chromium'
).toLowerCase()

const isChromiumBased =
  browser === 'chromium' ||
  browser === 'chrome' ||
  browser === 'edge' ||
  browser === 'chromium-based'
const isFirefox = browser === 'firefox'

function AppFooter({className, ...props}: AppFooterProps) {
  return (
    <div
      className={cn('flex w-full items-center justify-center', className)}
      {...props}
    >
      <div className="relative inline-flex items-center gap-3 rounded-2xl border px-4 py-2 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://extension.js.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2"
            aria-label="Visit extension.js.org"
          >
            <img
              className="size-4 select-none"
              alt="Extension.js logo"
              src={logo}
            />
            <span className="sr-only">extension.js</span>
          </a>
          <a
            href="https://extension.js.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground text-sm underline underline-offset-4 hover:opacity-90"
          >
            Learn more about developing cross-browser extensions.
          </a>
        </div>
        {isChromiumBased ? (
          <div className="ml-auto">
            <ConfirmSetupDialog />
          </div>
        ) : null}
      </div>
    </div>
  )
}

async function onStartup(
  setExtension: (extension: chrome.management.ExtensionInfo) => void,
  setDescription: (description: string) => void
) {
  const fromBg = await getDevExtension()
  if (fromBg) {
    setExtension(fromBg)
    setDescription(fromBg.description)
    return
  }

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
  const [resolvedIconUrl, setResolvedIconUrl] = useState<string | undefined>(
    undefined
  )
  const [iconFailed, setIconFailed] = useState(false)

  useEffect(() => {
    onStartup(setExtension, setDescription)
  }, [])

  const userIconUrl =
    extension?.icons && extension.icons.length
      ? [...extension.icons].sort((a, b) => (b.size || 0) - (a.size || 0))[0]
          ?.url
      : undefined

  // Firefox blocks cross-extension moz-extension URLs in pages, so resolve
  // the icon to a data URL before rendering it.
  const needsResolvedIcon =
    isFirefox && Boolean(userIconUrl) && !userIconUrl?.startsWith('data:')

  useEffect(() => {
    let isActive = true

    setIconFailed(false)

    if (!userIconUrl) {
      setResolvedIconUrl(undefined)
      return () => {
        isActive = false
      }
    }

    if (!needsResolvedIcon) {
      setResolvedIconUrl(userIconUrl)
      return () => {
        isActive = false
      }
    }

    setResolvedIconUrl(undefined)

    const iconSize =
      extension?.icons && extension.icons.length
        ? Math.max(...extension.icons.map((icon) => icon.size || 0))
        : 128

    type ManagementGetIcon = (
      id: string,
      size: number,
      callback: (dataUrl?: string) => void
    ) => void

    const tryManagementIcon = () =>
      new Promise<string | undefined>((resolve) => {
        try {
          const getIcon = (
            chrome.management as typeof chrome.management & {
              getIcon?: ManagementGetIcon
            }
          ).getIcon

          if (!extension?.id || !getIcon) {
            resolve(undefined)
            return
          }

          getIcon(extension.id, iconSize, (dataUrl) => {
            resolve(
              typeof dataUrl === 'string' && dataUrl ? dataUrl : undefined
            )
          })
        } catch {
          resolve(undefined)
        }
      })

    tryManagementIcon().then((dataUrl) => {
      if (!isActive) return
      if (dataUrl) {
        setResolvedIconUrl(dataUrl)
        return
      }

      try {
        chrome.runtime.sendMessage(
          {type: 'resolve-icon-url', url: userIconUrl},
          (response) => {
            if (!isActive) return
            if (response?.ok && typeof response.dataUrl === 'string') {
              setResolvedIconUrl(response.dataUrl)
            } else {
              setResolvedIconUrl(undefined)
            }
          }
        )
      } catch {
        setResolvedIconUrl(undefined)
      }
    })

    return () => {
      isActive = false
    }
  }, [userIconUrl, needsResolvedIcon, extension?.id])

  return (
    <div className="relative flex h-screen flex-col items-center justify-center bg-[#1C1C1E]">
      <style>{`
        @keyframes neonPulse {
          0%, 100% {
            text-shadow:
              0 0 6px rgba(25, 245, 167, 0.55),
              0 0 12px rgba(25, 245, 167, 0.45),
              0 0 24px rgba(25, 245, 167, 0.35);
          }
          50% {
            text-shadow:
              0 0 10px rgba(25, 245, 167, 0.9),
              0 0 20px rgba(25, 245, 167, 0.8),
              0 0 40px rgba(25, 245, 167, 0.7);
          }
        }
        .neon-text {
          animation: neonPulse 1.8s ease-in-out infinite;
        }
      `}</style>
      <header className="mb-4 flex w-full items-center justify-center">
        <div className="border-border/50 bg-muted/40 relative inline-flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border shadow-sm">
          <img
            className="size-12 select-none object-contain"
            alt={`${extension?.name || 'User extension'} icon`}
            src={
              iconFailed
                ? logo
                : needsResolvedIcon
                  ? resolvedIconUrl || logo
                  : resolvedIconUrl || userIconUrl || logo
            }
            onError={() => setIconFailed(true)}
          />
        </div>
      </header>
      <h1 className="text-foreground mx-auto text-center text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
        <span>{extension?.name || 'My Extension'}</span>
        <br />
        <span
          id="extensionName"
          title={
            extension
              ? `• Name: ${extension.name}
• ID: ${extension.id}
• Version: ${extension.version}`
              : ''
          }
          className="neon-text"
          style={{color: 'var(--brand-success, #19f5a7)'}}
        >
          loaded successfully
        </span>
      </h1>
      <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-center text-base leading-relaxed sm:text-lg">
        {description ||
          extension?.description ||
          'Extension.js makes cross‑browser extension development simple.'}
      </p>
      <AppFooter className="mt-6" />
    </div>
  )
}

const rootElement = document.getElementById('root')

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(<Welcome />)
}
