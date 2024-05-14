export default function patchGeckoId(manifestPath: string) {
  const manifest = require(manifestPath)
  // Ensure the name is lowercase and separated by hyphens. No special character allowed.
  const manifestName = manifest.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')

  return `${manifestName}@extension-js`
}
