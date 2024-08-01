function getManifest() {
  return chrome.runtime.getManifest()
}
const manifest = getManifest()

console.log('ok??')
console.table({
  name: manifest.name,
  version: manifest.version,
  description: manifest.description
})
