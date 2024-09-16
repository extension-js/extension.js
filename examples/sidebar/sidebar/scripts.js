function getManifest() {
  return chrome.runtime.getManifest()
}

const manifestData = getManifest()

console.table({
  name: manifestData.name,
  version: manifestData.version,
  description: manifestData.description
})
