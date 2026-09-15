// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Plain DOM on purpose: the page is one small screen, and a UI framework
// would ship innerHTML code that the AMO store check flags in Firefox builds.
import logo from '@/images/logo.png'
import {applyTheme} from '@/lib/utils'
import {getDevExtension} from '@/background/define-initial-tab'

import '@/styles.css'

// The page paints a dark backdrop whatever the OS theme, so the tokens
// must be the dark set or the heading lands dark on dark.
applyTheme('dark')

type ExtensionInfo = chrome.management.ExtensionInfo

const isFirefox =
  String(
    // @ts-ignore
    import.meta.env.EXTENSION_BROWSER || 'chromium'
  ).toLowerCase() === 'firefox'

const DEFAULT_NAME = 'My Extension'
const DEFAULT_DESCRIPTION =
  'Extension.js makes cross‑browser extension development simple.'
const SITE_URL = 'https://extension.js.org/'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function externalLink(className: string): HTMLAnchorElement {
  const link = el('a', className)
  link.href = SITE_URL
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
}

async function findExtension(): Promise<ExtensionInfo> {
  const fromBg = await getDevExtension()
  if (fromBg) return fromBg

  const all = (await new Promise((resolve) => {
    try {
      chrome.management.getAll(resolve)
    } catch {
      resolve([])
    }
  })) as ExtensionInfo[]

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
  if (userExtension) return userExtension

  const manifest = chrome.runtime.getManifest()

  return {
    id: chrome.runtime.id,
    name: manifest?.name || 'Extension',
    shortName: manifest?.short_name,
    description: manifest?.description || '',
    version: manifest?.version || '',
    enabled: true,
    installType: 'development'
  } as ExtensionInfo
}

function largestIconUrl(extension: ExtensionInfo): string | undefined {
  if (!extension.icons || !extension.icons.length) return undefined
  return [...extension.icons].sort((a, b) => (b.size || 0) - (a.size || 0))[0]
    ?.url
}

// Firefox blocks cross-extension moz-extension URLs in pages, so the
// background resolves the icon to a data URL before the page shows it.
function resolveIconInBackground(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        {type: 'resolve-icon-url', url},
        (response) => {
          resolve(
            response?.ok && typeof response.dataUrl === 'string'
              ? response.dataUrl
              : undefined
          )
        }
      )
    } catch {
      resolve(undefined)
    }
  })
}

function renderFooter(): HTMLElement {
  const footer = el('div', 'mt-6 flex w-full items-center justify-center')
  const pill = el(
    'div',
    'relative inline-flex items-center gap-3 rounded-2xl border px-4 py-2 shadow-sm backdrop-blur'
  )
  const row = el('div', 'flex flex-wrap items-center gap-3')

  const logoLink = externalLink('inline-flex items-center gap-2')
  logoLink.setAttribute('aria-label', 'Visit extension.js.org')
  const logoImage = el('img', 'size-4 select-none')
  logoImage.alt = 'Extension.js logo'
  logoImage.src = logo
  logoLink.append(logoImage, el('span', 'sr-only', 'extension.js'))

  const learnMore = externalLink(
    'text-muted-foreground text-sm underline underline-offset-4 hover:opacity-90'
  )
  learnMore.textContent = 'Learn more about developing cross-browser extensions.'

  row.append(logoLink, learnMore)
  pill.append(row)
  footer.append(pill)
  return footer
}

function renderWelcome(root: HTMLElement) {
  const page = el(
    'div',
    'relative flex h-screen flex-col items-center justify-center bg-[#1C1C1E]'
  )

  const header = el('header', 'mb-4 flex w-full items-center justify-center')
  const icon = el('img', 'size-16 select-none object-contain')
  icon.alt = 'User extension icon'
  icon.src = logo
  let iconFailed = false
  icon.addEventListener('error', () => {
    if (iconFailed) return
    iconFailed = true
    icon.src = logo
  })
  header.append(icon)

  const title = el(
    'h1',
    'text-foreground mx-auto text-center text-3xl font-semibold leading-tight tracking-tight sm:text-4xl'
  )
  const name = el('span', undefined, DEFAULT_NAME)
  const status = el('span', 'neon-text', 'loaded successfully')
  status.id = 'extensionName'
  status.style.color = 'var(--brand-success, #19f5a7)'
  title.append(name, el('br'), status)

  const description = el(
    'p',
    'text-muted-foreground mx-auto mt-3 max-w-xl text-center text-base leading-relaxed sm:text-lg',
    DEFAULT_DESCRIPTION
  )

  page.append(header, title, description, renderFooter())
  root.replaceChildren(page)

  findExtension()
    .then(async (extension) => {
      name.textContent = extension.name || DEFAULT_NAME
      status.title = [
        `• Name: ${extension.name}`,
        `• ID: ${extension.id}`,
        `• Version: ${extension.version}`
      ].join('\n')
      description.textContent = extension.description || DEFAULT_DESCRIPTION
      icon.alt = `${extension.name || 'User extension'} icon`

      const userIconUrl = largestIconUrl(extension)
      if (!userIconUrl) return

      if (isFirefox && !userIconUrl.startsWith('data:')) {
        const dataUrl = await resolveIconInBackground(userIconUrl)
        if (dataUrl && !iconFailed) icon.src = dataUrl
        return
      }

      if (!iconFailed) icon.src = userIconUrl
    })
    .catch(() => {
      // Ignore
    })
}

const rootElement = document.getElementById('root')

if (rootElement) {
  renderWelcome(rootElement)
}
