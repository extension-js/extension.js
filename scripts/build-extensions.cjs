// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const {execSync} = require('node:child_process')

const ENGINES = ['chromium', 'chrome', 'edge', 'firefox']
const BUILD_TARGETS = [
  'build:chromium',
  'build:chrome',
  'build:firefox',
  'build:edge'
]
const BUNDLED_PACKAGES = ['extension-js-devtools', 'extension-js-theme']
const STAMP_FILE = 'build-stamp.json'

function main() {
  const root = path.resolve(__dirname, '..')
  const developDist = path.join(root, 'programs', 'develop', 'dist')

  // Use the same Node as the current process for all child spawns (cross-platform:
  // avoids Windows Node path being used in WSL/Git Bash, or wrong node in PATH).
  const nodeDir = path.dirname(process.execPath)
  const existingPath = process.env.PATH || process.env.Path || ''
  const childEnv = {
    ...process.env,
    PATH: `${nodeDir}${path.delimiter}${existingPath}`
  }

  const verbose = String(process.env.EXTENSION_VERBOSE || '').trim() === '1'

  function printChildOutput(error) {
    const stdout = error?.stdout ? String(error.stdout) : ''
    const stderr = error?.stderr ? String(error.stderr) : ''
    const output = `${stdout}${stderr}`.trim()

    if (output.length > 0) {
      console.error(output)
    }
  }

  // Discover top-level extension packages (directories) under extensions/,
  // excluding the folder named 'browser-extension' and 'monorepo'
  function listExtensionPackages() {
    const extensionsRoot = path.join(root, 'extensions')

    try {
      const entries = fs.readdirSync(extensionsRoot, {withFileTypes: true})

      return entries
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((name) => name !== 'browser-extension' && name !== 'monorepo')
    } catch {
      return []
    }
  }

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
        if (!verbose) printChildOutput(error)

        throw error
      }
    }
  }

  // The bundled extensions embed the develop pipeline, so a mirrored copy is
  // only fresh when its stamp names the current content hash of develop/dist.
  function hashDevelopPipeline() {
    if (!fs.existsSync(developDist)) {
      throw new Error(
        `[Extension.js] ${developDist} is missing. Compile extension-develop before building the bundled extensions.`
      )
    }

    const mirrored = new Set(listExtensionPackages())
    const hash = crypto.createHash('sha256')

    function walk(dir, rel) {
      const entries = fs
        .readdirSync(dir, {withFileTypes: true})
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

      for (const entry of entries) {
        const skip =
          rel === '' &&
          (mirrored.has(entry.name) || entry.name.endsWith('__tmp'))
        if (skip) continue

        const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`
        const full = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          walk(full, entryRel)
        } else if (entry.isFile()) {
          hash.update(entryRel)
          hash.update('\0')
          hash.update(fs.readFileSync(full))
          hash.update('\0')
        }
      }
    }

    walk(developDist, '')

    return hash.digest('hex')
  }

  function buildAllTargets(pkgRoot, packageName) {
    for (const script of BUILD_TARGETS) {
      try {
        execSync(`pnpm run -s ${script}`, {
          cwd: pkgRoot,
          stdio: verbose ? 'inherit' : 'pipe',
          env: childEnv
        })
      } catch (error) {
        if (!verbose) printChildOutput(error)

        throw new Error(
          `[Extension.js] ${packageName} ${script} failed with exit code ${error?.status ?? 'unknown'}.`
        )
      }
    }
  }

  // A pre-existing dist is never proof of a fresh build: it is removed before
  // the rebuild so a failed target leaves nothing to mirror.
  function rebuildExtension(packageName) {
    const pkgRoot = path.join(root, 'extensions', packageName)
    const distRoot = path.join(pkgRoot, 'dist')

    if (!fs.existsSync(path.join(pkgRoot, 'package.json'))) {
      throw new Error(`[Extension.js] ${packageName} has no package.json.`)
    }

    if (verbose) {
      console.log(`[Extension.js] Rebuilding ${packageName}…`)
    }

    fs.rmSync(distRoot, {recursive: true, force: true})
    ensureDependencies(pkgRoot)
    buildAllTargets(pkgRoot, packageName)

    const missing = ENGINES.filter(
      (engine) => !fs.existsSync(path.join(distRoot, engine, 'manifest.json'))
    )

    if (missing.length > 0) {
      throw new Error(
        `[Extension.js] ${packageName} build produced no manifest for: ${missing.join(', ')}`
      )
    }

    return distRoot
  }

  // A temp folder + rename avoids EEXIST errors from cpSync on macOS.
  function mirrorExtension(packageName, src, pipeline) {
    const dest = path.join(developDist, packageName)
    const tmpDest = `${dest}__tmp`

    fs.rmSync(tmpDest, {recursive: true, force: true})
    fs.cpSync(src, tmpDest, {recursive: true, force: true})
    fs.writeFileSync(
      path.join(tmpDest, STAMP_FILE),
      `${JSON.stringify({pipeline, builtAt: new Date().toISOString()}, null, 2)}\n`
    )

    fs.rmSync(dest, {recursive: true, force: true})
    fs.renameSync(tmpDest, dest)
  }

  function verifyExtensionMirrored(packageName, pipeline) {
    const base = path.join(developDist, packageName)
    const problems = []

    for (const engine of ENGINES) {
      const manifestPath = path.join(base, engine, 'manifest.json')

      if (!fs.existsSync(manifestPath)) {
        problems.push(`for "${engine}" is missing at ${manifestPath}.`)
      }
    }

    const stampPath = path.join(base, STAMP_FILE)
    let stamp = null

    try {
      stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
    } catch {
      // Ignore
    }

    if (!stamp || typeof stamp.pipeline !== 'string') {
      problems.push(
        `has no build stamp at ${stampPath}, so it is not proven fresh.`
      )
    } else if (stamp.pipeline !== pipeline) {
      problems.push(
        `was built against another develop pipeline (stamp ${stamp.pipeline.slice(0, 12)} from ${stamp.builtAt}, current ${pipeline.slice(0, 12)}).`
      )
    }

    for (const problem of problems) {
      console.error(`[Extension.js] ${packageName} ${problem}`)
      process.exitCode = 1
    }
  }

  const pipeline = hashDevelopPipeline()
  const failed = []

  for (const packageName of listExtensionPackages()) {
    try {
      mirrorExtension(packageName, rebuildExtension(packageName), pipeline)
    } catch (error) {
      console.error(String(error?.message || error))
      failed.push(packageName)
    }
  }

  for (const packageName of BUNDLED_PACKAGES) {
    verifyExtensionMirrored(packageName, pipeline)
  }

  if (failed.length > 0) {
    console.error(
      `[Extension.js] Bundled extension build failed for: ${failed.join(', ')}. Nothing was mirrored for them into ${developDist}.`
    )

    process.exitCode = 1
  }
}

try {
  main()
} catch (error) {
  console.error(String(error?.message || error))
  process.exitCode = 1
}
