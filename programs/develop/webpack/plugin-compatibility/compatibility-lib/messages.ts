export function webextensionPolyfillNotFound() {
  return (
    `Warning: webextension-polyfill not found. ` +
    `Browser API polyfill will not be available.\n` +
    `To fix this, install webextension-polyfill: npm install webextension-polyfill`
  )
}
