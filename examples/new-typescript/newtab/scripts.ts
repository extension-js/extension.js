function getRuntimeManifest() {
  return chrome.runtime.getManifest()
}
const manifestData = getRuntimeManifest()

console.table({
  name: manifestData.name,
  version: manifestData.version,
  description: manifestData.description
})
