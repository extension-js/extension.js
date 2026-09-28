// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Browsers whose startup tab is not a plain new tab page, by the url the
// tabs API reports for it. Opera starts on Speed Dial, Edge on an MSN page
// its newtab redirects to before this runs, and Yandex on its own search
// homepage (ya.ru through sso.ya.ru on the build whose brand pins yandex.ru,
// yandex.<tld> left for the regional builds). Without these the first run
// branch never fires there, the newtab override never renders, and the
// reader gets no sign the extension loaded.
export const START_PAGES_WITHOUT_NEW_TAB: readonly RegExp[] = [
  /^chrome:\/\/startpage(?:shared)?\/?/,
  /^https:\/\/(?:[a-z0-9-]+\.)*msn\.com\//i,
  /^https:\/\/(?:[a-z0-9-]+\.)*(?:ya\.ru|yandex\.[a-z.]+)\//i
]

export function isStartPage(url: string, browser: string | undefined): boolean {
  if (browser === 'firefox') {
    return (
      url.startsWith('about:home') ||
      url.startsWith('about:welcome') ||
      url.startsWith('about:newtab') ||
      url === 'about:blank'
    )
  }

  const scheme = browser === 'edge' ? 'edge' : 'chrome'

  return (
    url.startsWith(`${scheme}://newtab`) ||
    url.startsWith(`${scheme}://welcome`) ||
    START_PAGES_WITHOUT_NEW_TAB.some((pattern) => pattern.test(url))
  )
}

export const MAX_REPOINT_ATTEMPTS = 3

export type RepointDecision = 'wait' | 'repoint' | 'stop'

// A start tab can still be mid-redirect when it is repointed (Yandex hops
// through its own sign-in ping, Edge to MSN), and the later hop wins.
export function decideRepoint(input: {
  tabId: number
  updatedTabId: number
  status: string | undefined
  url: string | undefined
  targetUrl: string
  attempts: number
}): RepointDecision {
  if (input.updatedTabId !== input.tabId || input.status !== 'complete') {
    return 'wait'
  }

  if (String(input.url || '').startsWith(input.targetUrl)) return 'wait'
  if (input.attempts >= MAX_REPOINT_ATTEMPTS) return 'stop'

  return 'repoint'
}
