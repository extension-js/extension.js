const fs = require('fs')
const path = require('path')
const {execSync} = require('child_process')

function main() {
  const root = path.resolve(__dirname, '..')
  const src = path.join(
    root,
    'extensions',
    'extension-js-devtools',
    'dist'
  )
  const dest = path.join(
    root,
    'programs',
    'develop',
    'dist',
    'extension-js-devtools'
  )

  const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'

  // Build devtools if dist is missing, then try to copy again
  if (!fs.existsSync(src)) {
    try {
      const devtoolsRoot = path.join(
        root,
        'extensions',
        'extension-js-devtools'
      )
      if (fs.existsSync(devtoolsRoot)) {
        if (verbose) {
          console.log(
            '[Extension.js] Devtools dist missing. Attempting to build devtools…'
          )
        }
        // Ensure dependencies
        const nodeModules = path.join(devtoolsRoot, 'node_modules')
        const needsInstall =
          !fs.existsSync(nodeModules) ||
          (fs.existsSync(nodeModules) &&
            fs.readdirSync(nodeModules).length === 0)
        if (needsInstall) {
          execSync('pnpm install --silent', {
            cwd: devtoolsRoot,
            stdio: verbose ? 'inherit' : 'ignore'
          })
        }
        // Build all targets we know about; ignore failures for any individual one
        const targets = ['build:chromium', 'build:chrome', 'build:firefox', 'build:edge']
        for (const script of targets) {
          try {
            execSync(`pnpm run -s ${script}`, {
              cwd: devtoolsRoot,
              stdio: verbose ? 'inherit' : 'ignore'
            })
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore build issues; copy will be skipped if still missing
    }
  }

  if (!fs.existsSync(src)) {
    if (verbose) {
      console.warn(
        '[Extension.js] Devtools dist still missing after postcompile. Skipping mirror.'
      )
    }
    return
  }

  try {
    // Reset destination
    fs.rmSync(dest, {recursive: true, force: true})
  } catch {}

  fs.mkdirSync(dest, {recursive: true})
  // Node 18+: fast recursive copy
  fs.cpSync(src, dest, {recursive: true, force: true})
}

main()
