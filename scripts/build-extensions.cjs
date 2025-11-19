const fs = require('fs')
const path = require('path')
const {execSync} = require('child_process')

function main() {
  const root = path.resolve(__dirname, '..')

  const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'

  // Ensure dependencies are installed in the given package folder.
  function ensureDependencies(pkgRoot) {
    const nodeModules = path.join(pkgRoot, 'node_modules')
    const needsInstall =
      !fs.existsSync(nodeModules) ||
      (fs.existsSync(nodeModules) && fs.readdirSync(nodeModules).length === 0)

    if (needsInstall) {
      execSync('pnpm install --silent', {
        cwd: pkgRoot,
        stdio: verbose ? 'inherit' : 'ignore'
      })
    }
  }
 
  // Try to build all known targets for a given package folder.
  // Errors for individual targets are ignored to maximize overall success.
  function buildAllTargets(pkgRoot) {
    const targets = ['build:chromium', 'build:chrome', 'build:firefox', 'build:edge']
    for (const script of targets) {
      try {
        execSync(`pnpm run -s ${script}`, {
          cwd: pkgRoot,
          stdio: verbose ? 'inherit' : 'ignore'
        })
      } catch {
        // ignore failures of individual targets
      }
    }
  }
 
  // Ensure a given extension package has a dist folder and mirror it into programs/develop/dist.
  // If dist is missing, attempts to install and build before mirroring.
  function buildAndMirror(packageName) {
    const src = path.join(root, 'extensions', packageName, 'dist')
    const dest = path.join(root, 'programs', 'develop', 'dist', packageName)
 
    // Build if dist is missing, then try to copy again
    if (!fs.existsSync(src)) {
      try {
        const pkgRoot = path.join(root, 'extensions', packageName)
        const hasPackageJson = fs.existsSync(path.join(pkgRoot, 'package.json'))
        if (fs.existsSync(pkgRoot) && hasPackageJson) {
          if (verbose) {
            console.log(
              `[Extension.js] ${packageName} dist missing. Attempting to build…`
            )
          }
          ensureDependencies(pkgRoot)
          buildAllTargets(pkgRoot)
        }
      } catch {
        // ignore build issues; copy will be skipped if still missing
      }
    }
 
    if (!fs.existsSync(src)) {
      if (verbose) {
        console.warn(`[Extension.js] ${packageName} dist missing. Skipping mirror.`)
      }
      return
    }
 
    // Reset destination and copy dist
    try {
      fs.rmSync(dest, {recursive: true, force: true})
    } catch {
      // ignore
    }
    fs.mkdirSync(dest, {recursive: true})
    fs.cpSync(src, dest, {recursive: true, force: true})
  }
 
  // Discover top-level extension packages (directories) under extensions/,
  // excluding the folder named 'browser-extension'.
  function listExtensionPackages() {  
    const extensionsRoot = path.join(root, 'extensions')
    try {
      const entries = fs.readdirSync(extensionsRoot, {withFileTypes: true})
      return entries
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(name => name !== 'browser-extension')
    } catch {
      return []
    }
  }
 
  // Build and mirror all discovered extension packages except 'browser-extension'
  for (const packageName of listExtensionPackages()) {
    buildAndMirror(packageName)
  }
}

main()
