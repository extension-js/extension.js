import './hmr'
console.log('Hello from content script!!')

// Assets
const assets = new URL('./assets/file.txt', import.meta.url)
fetch(assets)
  .then((response) => response.text())
  .then((file) => console.log(`[Assets test] Assets ${assets}: ${file}`))
  .catch((err) => {
    console.warn(`[Assets test] Error while loading asset ${assets}
If you want to load this from content scripts,
try add "web_accessible_resources": ["/dist/*.txt"] in your manifest.json.

WARNING: Normal web sites like ${location} can access those resources too. Be caution.`)
  })

// Dynamic import
setTimeout(async () => {
  const {add} = await import('./shared/utils.js')
  console.log('[import test] import("/shared/utils.js")', add)
}, 200)
