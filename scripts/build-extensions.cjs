const fs = require('fs')
const path = require('path')
const {execSync} = require('child_process')

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, {recursive: true})

  const entries = fs.readdirSync(src, {withFileTypes: true})

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else if (entry.isSymbolicLink()) {
      try {
        const real = fs.realpathSync(srcPath)
        const data = fs.readFileSync(real)
        fs.writeFileSync(destPath, data)
      } catch {
        // Ignore
      }
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function main() {
  const root = path.resolve(__dirname, '..')
  const extensionsDir = path.join(root, 'extensions')
  const developDistRoot = path.join(root, 'programs', 'develop', 'dist')

  if (!fs.existsSync(extensionsDir)) return
  const entries = fs.readdirSync(extensionsDir, {withFileTypes: true})

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const extName = entry.name
    const extRoot = path.join(extensionsDir, extName)

    // Skip folders without package.json
    const pkgJson = path.join(extRoot, 'package.json')
    if (!fs.existsSync(pkgJson)) continue

    try {
      const nodeModules = path.join(extRoot, 'node_modules')
      const needsInstall =
        !fs.existsSync(nodeModules) ||
        (fs.existsSync(nodeModules) && fs.readdirSync(nodeModules).length === 0)
      if (needsInstall) {
        execSync('pnpm install --silent', {cwd: extRoot, stdio: 'inherit'})
      }
    } catch {
      // Ignore
    }

    // Build *all* possible targets. Do not stop after the first successful build.
    // Try all: build:chrome, build:firefox, build:edge, build:chromium, then generic build.
    const buildTargets = [
      'build:chromium',
      'build:chrome',
      'build:firefox',
      'build:edge',
    ];
    let anyBuildSucceeded = false;

    for (const script of buildTargets) {
      try {
        execSync(`pnpm run -s ${script}`, {cwd: extRoot, stdio: 'inherit'})
        anyBuildSucceeded = true;
      } catch {
        // Ignore individual script failures, keep going
      }
    }

    try {
      // Always attempt the generic build script last.
      execSync('pnpm run -s build', {cwd: extRoot, stdio: 'inherit'})
      anyBuildSucceeded = true;
    } catch {
      // Ignore
    }

    // Prefer src/dist first, then dist
    const extensionDistDir = path.join(extRoot, 'dist')
    if (!fs.existsSync(extensionDistDir)) continue

    const targets = [ 'chromium','chrome', 'edge', 'firefox']

    for (const browser of targets) {
      const src = path.join(extensionDistDir, browser)

      if (!fs.existsSync(src)) continue

      const dest = path.join(developDistRoot, extName, browser)
      copyDir(src, dest)
    }
  }
}

main()
