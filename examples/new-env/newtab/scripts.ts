function getManifestData() {
  return chrome.runtime.getManifest()
}
const extensionManifest = getManifestData()

console.table({
  name: extensionManifest.name,
  version: extensionManifest.version,
  description: process.env.EXTENSION_PUBLIC_DESCRIPTION_TEXT
})
