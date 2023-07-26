import '../hmr'
console.log('[Worker test] [Inside Worker] I am a Worker!')

// Assets
const assets = new URL('../assets/file.txt', import.meta.url)
fetch(assets)
  .then((response) => response.text())
  .then((file) =>
    console.log(`[Assets test] [Inside Worker] Assets ${assets}: ${file}`)
  )

// Dynamic import
setTimeout(async () => {
  const {add} = await import('./utils.js')
  console.log('[import test] [Inside worker] I can dynamic import', add)
}, 200)
