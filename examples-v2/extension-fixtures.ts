import {
  test as base,
  chromium,
  type Page,
  type BrowserContext,
  type ElementHandle
} from '@playwright/test'

export const extensionFixtures = (
  pathToExtension: string,
  headless: boolean
) => {
  return base.extend<{
    context: BrowserContext
    extensionId: string
  }>({
    context: async ({}, use) => {
      const context = await chromium.launchPersistentContext('', {
        headless: false,
        args: [
          headless ? `--headless=new` : '',
          `--disable-extensions-except=${pathToExtension}`,
          `--load-extension=${pathToExtension}`,
          '--no-first-run', // Disable Chrome's native first run experience.
          '--disable-client-side-phishing-detection', // Disables client-side phishing detection
          '--disable-component-extensions-with-background-pages', // Disable some built-in extensions that aren't affected by '--disable-extensions'
          '--disable-default-apps', // Disable installation of default apps
          '--disable-features=InterestFeedContentSuggestions', // Disables the Discover feed on NTP
          '--disable-features=Translate', // Disables Chrome translation, both the manual option and the popup prompt when a page with differing language is detected.
          '--hide-scrollbars', // Hide scrollbars from screenshots.
          '--mute-audio', // Mute any audio
          '--no-default-browser-check', // Disable the default browser check, do not prompt to set it as such
          '--no-first-run', // Skip first run wizards
          '--ash-no-nudges', // Avoids blue bubble "user education" nudges (eg., "… give your browser a new look", Memory Saver)
          '--disable-search-engine-choice-screen', // Disable the 2023+ search engine choice screen
          '--disable-features=MediaRoute', // Avoid the startup dialog for `Do you want the application “Chromium.app” to accept incoming network connections?`.  Also disables the Chrome Media Router which creates background networking activity to discover cast targets. A superset of disabling DialMediaRouteProvider.
          '--use-mock-keychain', // Use mock keychain on Mac to prevent the blocking permissions dialog about "Chrome wants to use your confidential information stored in your keychain"
          '--disable-background-networking', // Disable various background network services, including extension updating, safe browsing service, upgrade detector, translate, UMA
          '--disable-breakpad', // Disable crashdump collection (reporting is already disabled in Chromium)
          '--disable-component-update', // Don't update the browser 'components' listed at chrome://components/
          '--disable-domain-reliability', // Disables Domain Reliability Monitoring, which tracks whether the browser has difficulty contacting Google-owned sites and uploads reports to Google.
          '--disable-features=AutofillServerCommunicatio', // Disables autofill server communication. This feature isn't disabled via other 'parent' flags.
          '--disable-features=CertificateTransparencyComponentUpdate',
          '--disable-sync', // Disable syncing to a Google account
          '--disable-features=OptimizationHints', // Used for turning on Breakpad crash reporting in a debug environment where crash reporting is typically compiled but disabled. Disable the Chrome Optimization Guide and networking with its service API
          '--disable-features=DialMediaRouteProvider', // A weaker form of disabling the MediaRouter feature. See that flag's details.
          '--no-pings', // Don't send hyperlink auditing pings
          '--enable-features=SidePanelUpdates' // Ensure the side panel is visible. This is used for testing the side panel feature.
        ].filter((arg) => !!arg)
      })
      await use(context)
      await context.close()
    },
    extensionId: async ({context}, use) => {
      /*
      // for manifest v2:
      let [background] = context.backgroundPages()
      if (!background)
        background = await context.waitForEvent('backgroundpage')
      */

      // for manifest v3:
      let [background] = context.serviceWorkers()
      if (!background) background = await context.waitForEvent('serviceworker')

      const extensionId = background.url().split('/')[2]
      await use(extensionId)
    }
  })
}

// Screenshot function
export async function takeScreenshot(page: any, screenshotPath: string) {
  await page.screenshot({path: screenshotPath})
}

/**
 * Utility to access elements inside the Shadow DOM.
 * @param page The Playwright Page object.
 * @param shadowHostSelector The selector for the Shadow DOM host element.
 * @param innerSelector The selector for the element inside the Shadow DOM.
 * @returns A Promise resolving to an ElementHandle for the inner element or null if not found.
 */
export async function getShadowRootElement(
  page: Page,
  shadowHostSelector: string,
  innerSelector: string
): Promise<ElementHandle<HTMLElement> | null> {
  // Wait for shadow host to be present first
  await page.waitForSelector(shadowHostSelector, {timeout: 15000})

  // Get the shadow host element
  const shadowHost = await page.$(shadowHostSelector)
  if (!shadowHost) return null

  // Get its shadow root
  const shadowRoot = await page.evaluateHandle(
    (host) => host.shadowRoot,
    shadowHost
  )
  if (!shadowRoot) return null

  // Find element within shadow root
  const element = await page.evaluateHandle(
    (root) => root?.querySelector(innerSelector),
    shadowRoot
  )

  return element.asElement() as ElementHandle<HTMLElement> | null
}
