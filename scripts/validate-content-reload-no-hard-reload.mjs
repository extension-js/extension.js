// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawn} from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, extname, join, resolve} from 'node:path'
import {
  countCompileSuccessEvents,
  describeReadyFailure,
  expectedChromiumExtensionId,
  isFreshContract,
  managedProfileDir,
  readReadyContract,
  readSessionEvents
} from './lib/session-contract.mjs'

const args = process.argv.slice(2)

function parseArg(name, fallback) {
  const idx = args.indexOf(name)
  if (idx === -1) return fallback
  const next = args[idx + 1]
  if (!next || next.startsWith('--')) return fallback
  return next
}

function parseFlag(name) {
  return args.includes(name)
}

const pkg = parseArg('--package', 'extension@canary')
const browser = parseArg('--browser', 'chromium')
const timeoutMs = Number(parseArg('--timeout-ms', '180000'))
const template = parseArg('--template', 'content-typescript')
const depth = Number(parseArg('--depth', '8'))
const projectArg = parseArg('--project', '')
const useLocalCreate = parseFlag('--use-local-create')
const keepTemp = parseFlag('--keep-temp')

const nodeDir = dirname(process.execPath)
const pathDelim = process.platform === 'win32' ? ';' : ':'
const childEnv = {
  ...process.env,
  EXTENSION_AUTHOR_MODE: 'true',
  PATH: `${nodeDir}${pathDelim}${process.env.PATH || process.env.Path || ''}`
}

const hardReloadFatalPatterns = [
  /Failed to force-reload extension/i,
  /'Extensions\.reload' wasn't found/i,
  /\[reload\] reloading extension \(reason:/i
]
const cdpBootstrapWarningPatterns = [
  /\[browser\] CDP post-launch setup failed/i,
  /Failed to connect to CDP:/i
]

function runCollect(cmd, cmdArgs, opts = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
      ...opts
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if ((code || 0) !== 0) {
        rejectPromise(
          new Error(
            `[${cmd} ${cmdArgs.join(' ')}] failed with code ${code}\n${stdout}\n${stderr}`
          )
        )
        return
      }
      resolvePromise({stdout, stderr})
    })
  })
}

function findByBasename(root, targetName, maxDepth) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries = []
    try {
      entries = readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
      } else if (entry.name === targetName) {
        out.push(full)
      }
    }
  }
  walk(root, 0)
  return out
}

function resolveSecurePreferencesPath(projectDir, ready) {
  const distPath = typeof ready?.distPath === 'string' ? ready.distPath : ''
  const candidates = []

  if (distPath) {
    const profilePath = managedProfileDir(distPath, browser)
    candidates.push(join(profilePath, 'Default', 'Secure Preferences'))
    candidates.push(join(profilePath, 'Secure Preferences'))
  }

  candidates.push(
    join(
      projectDir,
      'dist',
      `extension-profile-${browser}`,
      'Default',
      'Secure Preferences'
    )
  )

  const direct = candidates.find((p) => existsSync(p))
  if (direct) return direct

  const distDir = join(projectDir, 'dist')
  if (existsSync(distDir)) {
    const found = findByBasename(distDir, 'Secure Preferences', 4)
    if (found.length > 0) return found[0]
  }

  return null
}

function assertExtensionEnabledInPrefs(projectDir) {
  // The contract carries the dist the browser loaded; the ID Chrome assigns
  // an unpacked dist is a pure function of that path (or a manifest key).
  const ready = readReadyContract(projectDir, browser)
  if (!ready || typeof ready.distPath !== 'string') {
    throw new Error(
      `Could not read the ready contract for ${projectDir} (${browser}): ${describeReadyFailure(ready)}`
    )
  }

  const extensionId = expectedChromiumExtensionId(ready.distPath)
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(
      `Could not derive an extension ID from ready.json distPath: ${ready.distPath}`
    )
  }

  const securePrefsPath = resolveSecurePreferencesPath(projectDir, ready)
  if (!securePrefsPath) {
    return {
      checked: false,
      reason: `Secure Preferences not found under ${projectDir}`
    }
  }

  const st = statSync(securePrefsPath)
  if (!st.isFile()) {
    throw new Error(`Secure Preferences path is not a file: ${securePrefsPath}`)
  }
  const raw = readFileSync(securePrefsPath, 'utf-8')
  const prefs = JSON.parse(raw)
  const settings = prefs?.extensions?.settings || {}
  const ext = settings[extensionId]

  if (!ext) {
    throw new Error(
      `Extension ${extensionId} not found in ${securePrefsPath}. Available IDs: ${Object.keys(
        settings
      ).slice(0, 20)}`
    )
  }

  const reasons = ext.disable_reasons
  if (Array.isArray(reasons) && reasons.length > 0) {
    throw new Error(
      `Extension ${extensionId} is disabled in profile (disable_reasons=${JSON.stringify(
        reasons
      )})`
    )
  }

  return {checked: true, reason: null}
}

function resolveContentScriptSourcePath(projectDir) {
  const manifestPathCandidates = [
    join(projectDir, 'src', 'manifest.json'),
    join(projectDir, 'manifest.json')
  ]
  const manifestPath = manifestPathCandidates.find((pathCandidate) =>
    existsSync(pathCandidate)
  )
  if (!manifestPath) {
    throw new Error(
      `Manifest not found in expected locations: ${manifestPathCandidates.join(', ')}`
    )
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  const contentScripts = Array.isArray(manifest?.content_scripts)
    ? manifest.content_scripts
    : []

  const firstJs = contentScripts
    .flatMap((entry) => (Array.isArray(entry?.js) ? entry.js : []))
    .find((entry) => typeof entry === 'string' && entry.length > 0)

  if (!firstJs) {
    throw new Error(
      `Manifest does not declare a content script js entry: ${manifestPath}`
    )
  }

  const normalizedRelPath = String(firstJs).replace(/^\/+/, '')
  const candidateInSrc = resolve(projectDir, 'src', normalizedRelPath)
  const candidateFromRoot = resolve(projectDir, normalizedRelPath)
  const candidateFromManifestDir = resolve(
    dirname(manifestPath),
    normalizedRelPath
  )
  const foundCandidate = [
    candidateInSrc,
    candidateFromRoot,
    candidateFromManifestDir
  ].find((candidatePath) => existsSync(candidatePath))
  if (foundCandidate) return foundCandidate

  throw new Error(
    `Unable to resolve content script source path from manifest entry "${firstJs}"`
  )
}

// Compile progress comes from the session's events.ndjson timeline, not from
// matching the pretty compile line, which is free copy.
function countCompileSuccesses(projectDir, runId) {
  return countCompileSuccessEvents(
    readSessionEvents(projectDir, browser),
    runId
  )
}

function listFilesRecursively(root, maxDepth) {
  const out = []
  const walk = (dir, depthNow) => {
    if (depthNow > maxDepth) return
    let entries = []
    try {
      entries = readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depthNow + 1)
      else out.push(full)
    }
  }
  walk(root, 0)
  return out
}

function assertBundleContains(projectDir, marker) {
  const contentDistDir = join(projectDir, 'dist', browser, 'content_scripts')
  if (!existsSync(contentDistDir)) {
    throw new Error(
      `Content scripts output directory not found: ${contentDistDir}`
    )
  }
  const candidates = listFilesRecursively(contentDistDir, 4).filter(
    (filePath) => filePath.endsWith('.js')
  )
  if (candidates.length === 0) {
    throw new Error(`No content script bundles found under ${contentDistDir}`)
  }
  const hit = candidates.some((filePath) => {
    try {
      return readFileSync(filePath, 'utf-8').includes(marker)
    } catch {
      return false
    }
  })
  if (!hit) {
    throw new Error(
      `Updated deep marker "${marker}" not found in emitted content bundles under ${contentDistDir}`
    )
  }
}

function bundleContainsMarker(projectDir, marker) {
  const contentDistDir = join(projectDir, 'dist', browser, 'content_scripts')
  if (!existsSync(contentDistDir)) return false
  const candidates = listFilesRecursively(contentDistDir, 4).filter(
    (filePath) => filePath.endsWith('.js')
  )
  if (candidates.length === 0) return false
  return candidates.some((filePath) => {
    try {
      return readFileSync(filePath, 'utf-8').includes(marker)
    } catch {
      return false
    }
  })
}

function prepareDeepImportChain(projectDir, requestedDepth) {
  const contentScriptPath = resolveContentScriptSourcePath(projectDir)
  const originalContentScript = readFileSync(contentScriptPath, 'utf-8')
  const ext = extname(contentScriptPath) || '.js'
  const chainDepth = Number.isFinite(requestedDepth)
    ? Math.max(1, Math.min(30, Math.trunc(requestedDepth)))
    : 8
  const chainDir = join(dirname(contentScriptPath), '__extjs_smoke_chain__')
  mkdirSync(chainDir, {recursive: true})

  for (let i = 0; i <= chainDepth; i++) {
    const filePath = join(chainDir, `d${i}${ext}`)
    const nextImport =
      i < chainDepth
        ? `import {smokeDeepToken as nextToken} from './d${i + 1}'\n`
        : ''
    const tokenValue =
      i === chainDepth
        ? `'SMOKE_DEEP_TOKEN_INITIAL'`
        : `nextToken + ':${i.toString()}'`
    writeFileSync(
      filePath,
      `${nextImport}export const smokeDeepToken = ${tokenValue}\n`,
      'utf-8'
    )
  }

  appendFileSync(
    contentScriptPath,
    `\nimport {smokeDeepToken as __extjsSmokeDeepToken} from './__extjs_smoke_chain__/d0'\nconsole.debug('__extjsSmokeDeepToken', __extjsSmokeDeepToken)\n`,
    'utf-8'
  )

  return {
    contentScriptPath,
    leafPath: join(chainDir, `d${chainDepth}${ext}`),
    expectedMarker: 'SMOKE_DEEP_TOKEN_UPDATED',
    restoreState: {
      contentScriptPath,
      originalContentScript,
      chainDir
    }
  }
}

function runDevAndValidateContentReload(cwd, deepChain) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npm', ['run', 'dev', '--', `--browser=${browser}`], {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''
    let settled = false
    let editApplied = false
    let successGuardTimer = null
    let markerPollInterval = null
    let contractPollInterval = null
    let markerObserved = false
    let sawCdpBootstrapIssue = false
    const finish = (err) => {
      if (settled) return
      settled = true
      if (successGuardTimer) clearTimeout(successGuardTimer)
      if (markerPollInterval) clearInterval(markerPollInterval)
      if (contractPollInterval) clearInterval(contractPollInterval)
      // A session that never stamped a CDP port had no working CDP bootstrap;
      // that replaces matching the CDP error line on stdout.
      if (!sawCdpBootstrapIssue) {
        const ready = readReadyContract(cwd, browser)
        sawCdpBootstrapIssue = typeof ready?.cdpPort !== 'number'
      }
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, 1000)

      if (err) {
        rejectPromise(err)
      } else {
        resolvePromise({logs: output, sawCdpBootstrapIssue})
      }
    }

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Timeout waiting for content-script reload validation (${timeoutMs}ms)\n\nOutput tail:\n${output.slice(-8000)}`
        )
      )
    }, timeoutMs)

    const harnessStartMs = Date.now()

    contractPollInterval = setInterval(() => {
      if (settled) return

      const ready = readReadyContract(cwd, browser)
      // An external project may carry a prior session's contract; wait for
      // the contract this dev process writes.
      if (!ready || !isFreshContract(ready, harnessStartMs)) return
      if (ready.status === 'error') {
        clearTimeout(timeout)
        finish(
          new Error(
            `ready.json reported a failed session: ${describeReadyFailure(ready)}\n\nCaptured output:\n${output}`
          )
        )
        return
      }

      const compileCount = countCompileSuccesses(cwd, ready.runId)

      if (!editApplied && compileCount >= 1) {
        editApplied = true
        writeFileSync(
          deepChain.leafPath,
          `export const smokeDeepToken = '${deepChain.expectedMarker}'\n`,
          'utf-8'
        )
        // Detect rebuild by actual emitted bundle content, independent of
        // canary-specific compile log wording/format.
        markerPollInterval = setInterval(() => {
          if (markerObserved || settled) return
          if (bundleContainsMarker(cwd, deepChain.expectedMarker)) {
            markerObserved = true
            if (!successGuardTimer) {
              successGuardTimer = setTimeout(() => {
                clearTimeout(timeout)
                finish()
              }, 3000)
            }
          }
        }, 1000)
      }

      if (
        editApplied &&
        compileCount >= 2 &&
        !successGuardTimer &&
        !markerObserved
      ) {
        successGuardTimer = setTimeout(() => {
          clearTimeout(timeout)
          finish()
        }, 3000)
      }
    }, 1000)

    const onChunk = (chunk) => {
      const text = chunk.toString()
      output += text

      for (const pattern of hardReloadFatalPatterns) {
        if (pattern.test(text) || pattern.test(output)) {
          clearTimeout(timeout)
          finish(
            new Error(
              `Detected failure pattern: ${String(pattern)}\n\nCaptured output:\n${output}`
            )
          )
          return
        }
      }
      if (!sawCdpBootstrapIssue) {
        sawCdpBootstrapIssue = cdpBootstrapWarningPatterns.some(
          (pattern) => pattern.test(text) || pattern.test(output)
        )
      }
    }

    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    child.on('error', (error) => {
      clearTimeout(timeout)
      finish(error)
    })
    child.on('close', (code) => {
      if (settled) return
      clearTimeout(timeout)
      finish(
        new Error(`dev process exited early with code ${code}\n\n${output}`)
      )
    })
  })
}

async function main() {
  const usingExternalProject = Boolean(projectArg)
  const root = usingExternalProject
    ? dirname(resolve(projectArg))
    : mkdtempSync(join(tmpdir(), 'extjs-content-reload-'))
  const projectDir = usingExternalProject
    ? resolve(projectArg)
    : join(root, 'my-extensionz')

  if (!usingExternalProject) {
    console.log(`Using temp root: ${root}`)
    if (useLocalCreate) {
      console.log(
        `Creating with local CLI: pnpm extension create my-extensionz --template=${template}`
      )
    } else {
      console.log(
        `Creating with: npx -y ${pkg} create my-extensionz --template=${template}`
      )
    }
  } else {
    console.log(`Using existing project: ${projectDir}`)
  }

  let deepChain = null
  try {
    if (!usingExternalProject) {
      if (useLocalCreate) {
        await runCollect(
          'pnpm',
          ['extension', 'create', 'my-extensionz', `--template=${template}`],
          {cwd: root}
        )
      } else {
        await runCollect(
          'npx',
          ['-y', pkg, 'create', 'my-extensionz', `--template=${template}`],
          {cwd: root}
        )
      }
    }

    deepChain = prepareDeepImportChain(projectDir, depth)

    console.log(
      'Booting dev, editing deep content-script dependency, validating no hard reload...'
    )
    const {sawCdpBootstrapIssue} = await runDevAndValidateContentReload(
      projectDir,
      deepChain
    )
    assertBundleContains(projectDir, deepChain.expectedMarker)
    const prefsCheck = usingExternalProject
      ? {checked: false, reason: 'skipped for external project validation'}
      : assertExtensionEnabledInPrefs(projectDir)

    console.log(
      `PASS: deep content dependency edit was applied (${deepChain.leafPath})`
    )
    console.log(
      'PASS: rebuild completed after deep content dependency edit without hard reload signals'
    )
    console.log(
      `PASS: emitted content bundle contains updated deep marker (${deepChain.expectedMarker})`
    )
    if (sawCdpBootstrapIssue) {
      console.log(
        'WARN: CDP bootstrap issue observed, but it is non-fatal for this content HMR depth validation'
      )
    }
    if (prefsCheck.checked) {
      console.log('PASS: extension is enabled in browser profile preferences')
    } else {
      console.log(`WARN: profile-enabled check skipped (${prefsCheck.reason})`)
    }
    console.log(`Validated package: ${pkg}`)
  } finally {
    if (usingExternalProject && deepChain?.restoreState) {
      try {
        writeFileSync(
          deepChain.restoreState.contentScriptPath,
          deepChain.restoreState.originalContentScript,
          'utf-8'
        )
        rmSync(deepChain.restoreState.chainDir, {recursive: true, force: true})
      } catch (error) {
        console.warn(
          `Cleanup warning for external project ${projectDir}: ${String(error)}`
        )
      }
    } else if (!keepTemp && !usingExternalProject) {
      try {
        rmSync(root, {recursive: true, force: true})
      } catch (error) {
        console.warn(`Cleanup warning for ${root}: ${String(error)}`)
      }
    } else if (!usingExternalProject) {
      console.log(`Temp directory preserved: ${root}`)
    }
  }
}

main().catch((error) => {
  console.error('FAIL: deterministic content-script reload validation failed')
  console.error(String(error?.stack || error))
  process.exit(1)
})
