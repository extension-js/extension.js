const fs = require('fs')
const path = require('path')
const {execSync} = require('child_process')

function main() {
  const root = path.resolve(__dirname, '..')

  // Use the same Node as the current process for all child spawns (cross-platform:
  // avoids Windows Node path being used in WSL/Git Bash, or wrong node in PATH).
  const nodeDir = path.dirname(process.execPath)
  const existingPath = process.env.PATH || process.env.Path || ''
  const childEnv = {
    ...process.env,
    PATH: `${nodeDir}${path.delimiter}${existingPath}`
  }

  const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'

  // Ensure dependencies are installed in the given package folder.
  function ensureDependencies(pkgRoot) {
    // Prefer a single workspace install to avoid per-package pnpm runs.
    const rootNodeModules = path.join(root, 'node_modules')
    const hasWorkspaceInstall =
      fs.existsSync(rootNodeModules) &&
      fs.readdirSync(rootNodeModules).length > 0
    if (hasWorkspaceInstall) return

    const nodeModules = path.join(pkgRoot, 'node_modules')
    const needsInstall =
      !fs.existsSync(nodeModules) ||
      (fs.existsSync(nodeModules) && fs.readdirSync(nodeModules).length === 0)

    if (needsInstall) {
      const installRoot = fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))
        ? root
        : pkgRoot

      try {
        execSync('pnpm install --silent', {
          cwd: installRoot,
          stdio: verbose ? 'inherit' : 'pipe',
          env: childEnv
        })
      } catch (error) {
        if (!verbose) {
          const stdout = error?.stdout ? String(error.stdout) : ''
          const stderr = error?.stderr ? String(error.stderr) : ''
          const output = `${stdout}${stderr}`.trim()
          if (output.length > 0) {
            console.error(output)
          }
        }
        throw error
      }
    }
  }

  // Try to build all known targets for a given package folder.
  // Errors for individual targets are ignored to maximize overall success.
  function buildAllTargets(pkgRoot, {strict = false} = {}) {
    const targets = [
      'build:chromium',
      'build:chrome',
      'build:firefox',
      'build:edge'
    ]
    for (const script of targets) {
      try {
        execSync(`pnpm run -s ${script}`, {
          cwd: pkgRoot,
          stdio: verbose || strict ? 'inherit' : 'ignore',
          env: childEnv
        })
      } catch (error) {
        if (strict) {
          throw error
        }
        // ignore failures of individual targets
      }
    }
  }

  function ensureExtensionDist(packageName) {
    const pkgRoot = path.join(root, 'extensions', packageName)
    const distRoot = path.join(pkgRoot, 'dist')
    const engines = ['chromium', 'chrome', 'edge', 'firefox']
    const missing = engines.filter((engine) => {
      const manifestPath = path.join(distRoot, engine, 'manifest.json')
      return !fs.existsSync(manifestPath)
    })

    if (missing.length === 0) return

    if (verbose) {
      console.log(
        `[Extension.js] ${packageName} missing dist for: ${missing.join(', ')}. Rebuilding…`
      )
    }

    ensureDependencies(pkgRoot)
    buildAllTargets(pkgRoot, {strict: true})

    const stillMissing = engines.filter((engine) => {
      const manifestPath = path.join(distRoot, engine, 'manifest.json')
      return !fs.existsSync(manifestPath)
    })
    if (stillMissing.length > 0) {
      throw new Error(
        `[Extension.js] ${packageName} build missing manifests for: ${stillMissing.join(
          ', '
        )}`
      )
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
        console.warn(
          `[Extension.js] ${packageName} dist missing. Skipping mirror.`
        )
      }
      return
    }

    // Reset destination and copy dist
    // Use a temp folder + rename to avoid EEXIST errors from cpSync on macOS.
    const tmpDest = `${dest}__tmp`
    try {
      fs.rmSync(tmpDest, {recursive: true, force: true})
    } catch {
      // ignore
    }
    try {
      fs.rmSync(dest, {recursive: true, force: true})
    } catch {
      // ignore
    }

    fs.cpSync(src, tmpDest, {recursive: true, force: true})

    try {
      fs.rmSync(dest, {recursive: true, force: true})
    } catch {
      // ignore
    }

    fs.renameSync(tmpDest, dest)
  }

  // Hard guard: ensure extension-js-devtools dist exists for all engines
  // before we cut a new extension-develop package. If this fails, we prefer
  // to fail the publish rather than ship a broken devtools experience.
  function verifyExtensionMirrored(packageName) {
    const engines = ['chromium', 'chrome', 'edge', 'firefox']
    const base = path.join(root, 'programs', 'develop', 'dist', packageName)

    for (const engine of engines) {
      const manifestPath = path.join(base, engine, 'manifest.json')
      if (!fs.existsSync(manifestPath)) {
        const msg = `[Extension.js] ${packageName} for "${engine}" is missing at ${manifestPath}.`
        // Always surface this; it's a hard failure for releases.
        console.error(msg)
        process.exitCode = 1
      }
    }
  }

  // Discover top-level extension packages (directories) under extensions/,
  // excluding the folder named 'browser-extension'
  function listExtensionPackages() {
    const extensionsRoot = path.join(root, 'extensions')
    try {
      const entries = fs.readdirSync(extensionsRoot, {withFileTypes: true})
      return entries
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((name) => name !== 'browser-extension')
    } catch {
      return []
    }
  }

  // Build and mirror all discovered extension packages except 'browser-extension'
  for (const packageName of listExtensionPackages()) {
    if (packageName === 'extension-js-devtools') {
      ensureExtensionDist(packageName)
    }
    if (packageName === 'extension-js-theme') {
      ensureExtensionDist(packageName)
    }

    buildAndMirror(packageName)
  }

  // After mirroring, verify devtools/theme are present for all engines.
  verifyExtensionMirrored('extension-js-devtools')
  verifyExtensionMirrored('extension-js-theme')
}

main()
