/**
 * From the docs at https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources#manifest_declaration
 * > Google Chrome emits an "Invalid match pattern" error if the pattern has a path other than '/*'.
 *
 * We need to ensure that paths are cleaned up from the matches to avoid this error.
 */
export function cleanMatches(matches: string[]) {
  return matches.map((match) => {
    try {
      const url = new URL(
        // Using a wildcard for the scheme (`*://`) is supported,
        // but URL cannot parse it
        match.replace(/^\*:\/\//, 'https://')
      )

      // URL.pathname will return `/` even if the URL is just
      // `https://extension.js.org`
      if (match.endsWith(url.pathname)) {
        return `${match.substring(0, match.length - url.pathname.length)}/*`
      } else if (url.pathname === '/') {
        return `${match}/*`
      }

      return match
    } catch {
      // Special cases like <all_urls> will fail the URL parse,
      // but we can ignore them
      return match
    }
  })
}
