function getManifest() {
  // eslint-disable-next-line no-undef
  return chrome.runtime.getManifest()
}

const manifest = getManifest()

console.table({
  name: manifest.name,
  version: manifest.version,
  description: manifest.description
})
