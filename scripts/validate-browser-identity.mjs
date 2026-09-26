// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {execFileSync, spawn, spawnSync} from 'node:child_process'
// spawnSync also lists gecko tabs through the CLI, see geckoPages.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync
} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import {dirname, join, resolve, sep} from 'node:path'
import {
  cliSpawnArgs,
  describeDevCli,
  resolveDevCli,
  resolveRepoCli
} from './lib/resolve-dev-cli.mjs'
import {
  expectedChromiumExtensionId,
  readReadyContract
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

// Every target the CLI can be asked for by name. Opera and Yandex are listed
// so an absent install is reported as a skip, never silently left out.
const ALL_TARGETS = [
  'chrome',
  'chromium',
  'edge',
  'brave',
  'opera',
  'vivaldi',
  'yandex',
  'firefox',
  'waterfox',
  'librewolf',
  'zen',
  'floorp'
]

const CHROMIUM_FAMILY = new Set([
  'chrome',
  'chromium',
  'edge',
  'brave',
  'opera',
  'vivaldi',
  'yandex',
  'chromium-binary'
])

// What the executable path must say about itself, per target. A fork must
// never resolve to a managed Chrome or Firefox: that is the exact shape of
// the defect this lane exists to catch.
const IDENTITY = {
  chrome: {
    binary: /google chrome|chrome for testing|[\\/]chrome[\\/]|google-chrome/i,
    card: /\bchrome\b/i,
    managedAllowed: true
  },
  chromium: {
    binary: /chromium/i,
    card: /chromium/i,
    managedAllowed: true
  },
  edge: {binary: /edge/i, card: /edge/i, managedAllowed: true},
  brave: {binary: /brave/i, card: /brave/i, managedAllowed: false},
  opera: {binary: /opera/i, card: /opera/i, managedAllowed: false},
  vivaldi: {binary: /vivaldi/i, card: /vivaldi/i, managedAllowed: false},
  yandex: {binary: /yandex/i, card: /yandex/i, managedAllowed: false},
  firefox: {binary: /firefox/i, card: /firefox/i, managedAllowed: true},
  waterfox: {binary: /waterfox/i, card: /waterfox/i, managedAllowed: false},
  librewolf: {
    binary: /librewolf/i,
    card: /librewolf/i,
    managedAllowed: false
  },
  zen: {binary: /[\\/]zen/i, card: /\bzen\b/i, managedAllowed: false},
  floorp: {binary: /floorp/i, card: /floorp/i, managedAllowed: false}
}

const pkg = parseArg('--package', 'extension@latest')
const useLocalCli = parseFlag('--use-local-cli')
const requested = parseArg('--browsers', ALL_TARGETS.join(','))
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean)
const chromiumBinary = parseArg('--chromium-binary', '')
const cacheMode = parseArg('--cache', 'warm')
const timeoutMs = Number(parseArg('--timeout-ms', '180000'))
const keepTemp = parseFlag('--keep-temp')

const nodeDir = dirname(process.execPath)
const pathDelim = process.platform === 'win32' ? ';' : ':'
const baseEnv = {
  ...process.env,
  PATH: `${nodeDir}${pathDelim}${process.env.PATH || process.env.Path || ''}`
}

// Mirrors the launcher's shared cache root, so the lane can tell whether the
// managed cache is warm (the only state in which the fork fallback can fire).
function managedCacheRoot(env = process.env) {
  const explicit = String(env.EXT_BROWSERS_CACHE_DIR || '').trim()
  if (explicit) return resolve(explicit)

  if (process.platform === 'win32') {
    const local = String(env.LOCALAPPDATA || '').trim()
    if (local) return join(local, 'extension.js', 'browsers')

    return join(homedir(), 'AppData', 'Local', 'extension.js', 'browsers')
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'extension.js', 'browsers')
  }

  const xdg = String(env.XDG_CACHE_HOME || '').trim()
  if (xdg) return join(xdg, 'extension.js', 'browsers')

  return join(homedir(), '.cache', 'extension.js', 'browsers')
}

function managedCacheIsWarm(root) {
  if (!existsSync(root)) return false

  try {
    return readdirSync(root).some((entry) => {
      const dir = join(root, entry)

      try {
        return readdirSync(dir).length > 0
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

function safeRealpath(p) {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

function samePath(a, b) {
  if (!a || !b) return false

  const left = safeRealpath(a)
  const right = safeRealpath(b)

  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function isInside(child, parent) {
  const c = safeRealpath(child)
  const p = safeRealpath(parent)

  return c === p || c.startsWith(p.endsWith(sep) ? p : `${p}${sep}`)
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

// The executable behind a pid, read from the OS rather than the contract, so
// the two can disagree. Null means the platform gave no answer.
function executableOfPid(pid) {
  try {
    if (process.platform === 'linux') {
      return realpathSync(`/proc/${pid}/exe`)
    }

    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `(Get-Process -Id ${pid} -ErrorAction Stop).Path`
        ],
        {encoding: 'utf8', timeout: 10_000}
      ).trim()

      return out || null
    }

    const out = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 10_000
    }).trim()

    return out || null
  } catch {
    return null
  }
}

function appBundleOf(binary) {
  if (process.platform !== 'darwin') return null

  let current = binary

  while (current && current !== dirname(current)) {
    if (current.endsWith('.app')) return current

    current = dirname(current)
  }

  return null
}

// The version the application reports for itself, never a version read off
// another browser. macOS reads the bundle plist; elsewhere the binary answers
// --version.
function versionOfBinary(binary) {
  const bundle = appBundleOf(binary)

  if (bundle) {
    try {
      return execFileSync(
        '/usr/libexec/PlistBuddy',
        [
          '-c',
          'Print :CFBundleShortVersionString',
          join(bundle, 'Contents', 'Info.plist')
        ],
        {encoding: 'utf8', timeout: 10_000}
      ).trim()
    } catch {
      // Fall through to --version.
    }
  }

  try {
    const result = spawnSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000
    })
    const text = `${result.stdout || ''}${result.stderr || ''}`
    const match = text.match(/\d+(?:\.\d+)+/)

    return match ? match[0] : ''
  } catch {
    return ''
  }
}

function numericVersion(text) {
  const match = String(text || '').match(/\d+(?:\.\d+)+/)

  return match ? match[0] : ''
}

function stripAnsi(text) {
  return String(text).replace(/\[[0-9;]*m/g, '')
}

// The card's Browser row, as the user sees it, with the label removed.
function cardBrowserRow(output) {
  const lines = stripAnsi(output).split(/\r?\n/)

  for (const line of lines) {
    const match = line.match(/^\s*Browser\s{2,}(.+?)\s*$/)
    if (match) return match[1]
  }

  return ''
}

function runCollect(cmd, cmdArgs, opts = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: baseEnv,
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

    child.on('error', reject)
    child.on('close', (code) => {
      if ((code || 0) !== 0) {
        reject(
          new Error(
            `[${cmd} ${cmdArgs.join(' ')}] failed with code ${code}\n${stdout}\n${stderr}`
          )
        )

        return
      }

      resolveRun({stdout, stderr})
    })
  })
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

// Stop the session and wait for it to be gone: the browser keeps writing
// its profile under dist until it exits, and the temp root is removed next.
async function killTree(child, browserPid) {
  const signalAll = (signal) => {
    try {
      child.kill(signal)
    } catch {
      // Already gone.
    }

    if (browserPid && pidAlive(browserPid)) {
      try {
        process.kill(browserPid, signal)
      } catch {
        // Already gone.
      }
    }
  }

  const gone = () =>
    child.exitCode !== null && (!browserPid || !pidAlive(browserPid))

  signalAll('SIGTERM')

  for (let i = 0; i < 25 && !gone(); i++) await sleep(200)

  if (!gone()) {
    signalAll('SIGKILL')

    for (let i = 0; i < 25 && !gone(); i++) await sleep(200)
  }
}

function tail(text, lines = 25) {
  return stripAnsi(text).split(/\r?\n/).slice(-lines).join('\n')
}

// One dev session: spawn, wait for the contract to name a live browser, read
// everything the assertions need, then tear the session down.
function runDevSession({projectDir, browser, devArgs, env, cli, inspect}) {
  return new Promise((resolveRun) => {
    const child = spawn(...cliSpawnArgs(cli, ['dev', ...devArgs]), {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''
    let settled = false
    let poll = null
    let exitCode = null
    let stage = 'starting'

    const done = async (result) => {
      if (settled) return

      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      const ready = readReadyContract(projectDir, browser)
      // The identity checks read the live pid, so they run before teardown.
      const verdict =
        result.outcome === 'ready' ? await inspect({ready, output}) : null
      await killTree(child, ready?.browserPid)
      resolveRun({...result, verdict, output, ready, exitCode})
    }

    const timer = setTimeout(() => {
      done({outcome: 'timeout', stage})
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      output += chunk.toString()
    })

    child.on('error', (error) => {
      output += `\n${String(error?.stack || error)}`
      done({outcome: 'exited'})
    })

    child.on('close', (code) => {
      exitCode = code
      done({outcome: 'exited'})
    })

    const gecko = !CHROMIUM_FAMILY.has(browser)

    poll = setInterval(() => {
      if (settled) return

      const ready = readReadyContract(projectDir, browser)
      if (!ready) return

      if (ready.status === 'error') {
        done({outcome: 'contract-error'})

        return
      }

      if (ready.status !== 'ready') return

      stage = 'compiled'

      if (typeof ready.browserPid !== 'number' || !ready.binary) return

      stage = 'launched'

      // Loaded means the browser confirmed the extension: a Chromium runtime
      // that attached, or a Gecko RDP install that answered with its port.
      const loaded = gecko
        ? typeof ready.rdpPort === 'number'
        : ready.runtime === 'attached' || typeof ready.cdpPort === 'number'

      if (!loaded) return

      stage = 'loaded'

      // The card prints after launch; give it a moment to land in stdout.
      if (!cardBrowserRow(output)) return

      // A gecko handoff can move the pid a beat after launch.
      setTimeout(() => done({outcome: 'ready'}), 1500)
      clearInterval(poll)
    }, 1000)
  })
}

// What the browser put on screen. A page is ours when it belongs to the user
// extension or a companion the session loaded, or when it is the engine's own
// blank surface. Anything else in front of a reader on a fresh profile is a
// fork's onboarding: Zen's import wizard, Floorp's release notes, Vivaldi's
// signup wizard (a chrome-extension:// page of Vivaldi's own UI, which is why
// the check compares ids and never trusts the scheme).
const ENGINE_BLANK_PAGES = [
  /^about:(blank|newtab|home|privatebrowsing)$/,
  // newtab-footer is a companion surface of the new tab page, not a page
  // competing for the reader: system Chromium 146 exposes it as its own target
  // while managed Chrome 151 does not, and it failed the check on that alone.
  /^chrome:\/\/(newtab|newtab-footer|new-tab-page|extensions|startpage|startpageshared)\/?$/,
  /^edge:\/\/(newtab|extensions)\/?$/,
  /^moz-extension:\/\//
]

function ownExtensionIds(ready) {
  const ids = new Set()
  if (typeof ready.extensionId === 'string') ids.add(ready.extensionId)

  for (const managed of Array.isArray(ready.managedExtensions)
    ? ready.managedExtensions
    : []) {
    if (typeof managed?.id === 'string' && managed.id) ids.add(managed.id)
  }

  return ids
}

function isOwnOrBlankPage(url, ownIds) {
  const text = String(url || '')
  if (!text) return true

  const extension = /^chrome-extension:\/\/([a-p]{32})\//.exec(text)
  if (extension) return ownIds.has(extension[1])

  return ENGINE_BLANK_PAGES.some((pattern) => pattern.test(text))
}

async function chromiumPages(cdpPort) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
  const list = await response.json()

  return list
    .filter((target) => target?.type === 'page')
    .map((target) => ({url: String(target.url || ''), title: target.title}))
}

// Gecko has no HTTP target list, so the session's own tab listing answers,
// through the CLI verb a user would run against the same dev session.
function geckoPages(cli, projectDir, browser) {
  const result = spawnSync(
    ...cliSpawnArgs(cli, [
      'inspect',
      '--list-tabs',
      `--browser=${browser}`,
      '--output',
      'json'
    ]),
    {cwd: projectDir, env: baseEnv, encoding: 'utf8', timeout: 30_000}
  )
  const text = `${result.stdout || ''}`
  const pages = []

  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value && typeof value === 'object') {
      if (
        typeof value.url === 'string' &&
        ('id' in value || 'title' in value)
      ) {
        pages.push({url: value.url, title: value.title})
      } else {
        for (const item of Object.values(value)) visit(item)
      }
    }
  }

  let envelope = null

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue

    try {
      envelope = JSON.parse(trimmed)
    } catch {
      // Not the envelope line.
    }
  }

  if (!envelope) {
    throw new Error(
      `inspect --list-tabs printed no envelope (exit ${result.status}): ${`${result.stderr || ''}`.trim().slice(0, 300)}`
    )
  }

  if (envelope.ok === false) {
    throw new Error(
      `inspect --list-tabs refused: ${envelope.error?.code || ''} ${envelope.error?.message || ''}`.trim()
    )
  }

  visit(envelope)

  return pages
}

async function foregroundPages({browser, ready, cli, projectDir}) {
  if (CHROMIUM_FAMILY.has(browser)) {
    if (typeof ready.cdpPort !== 'number') return null

    return chromiumPages(ready.cdpPort)
  }

  return geckoPages(cli, projectDir, browser)
}

// The chromium profile's own record of the extension, the same check the
// first-dev smoke runs, read from the profile the contract names.
function chromiumExtensionEnabled(ready) {
  const profilePath =
    typeof ready.profilePath === 'string' ? ready.profilePath : ''

  if (!profilePath) {
    return {checked: false, reason: 'no profilePath in ready.json'}
  }

  const candidates = [
    join(profilePath, 'Default', 'Secure Preferences'),
    join(profilePath, 'Secure Preferences'),
    join(profilePath, 'Default', 'Preferences'),
    join(profilePath, 'Preferences')
  ]
  const extensionId =
    (typeof ready.extensionId === 'string' && ready.extensionId) ||
    expectedChromiumExtensionId(ready.distPath)

  for (const file of candidates) {
    if (!existsSync(file)) continue

    try {
      const prefs = JSON.parse(readFileSync(file, 'utf8'))
      const entry = prefs?.extensions?.settings?.[extensionId]
      if (!entry) continue

      const reasons = entry.disable_reasons

      if (Array.isArray(reasons) && reasons.length > 0) {
        return {
          checked: true,
          ok: false,
          reason: `disabled: ${JSON.stringify(reasons)}`
        }
      }

      return {checked: true, ok: true}
    } catch {
      // Try the next file.
    }
  }

  return {
    checked: false,
    reason: `extension ${extensionId} not in the profile prefs yet`
  }
}

async function assertIdentity({
  target,
  browser,
  session,
  cacheRoot,
  pinnedBinary,
  cli,
  projectDir
}) {
  const failures = []
  const notes = []
  const ready = session.ready || {}
  const identity = IDENTITY[browser] || IDENTITY[target]
  const binary = String(ready.binary || '')
  const card = cardBrowserRow(session.output)

  // a. The contract names an executable that belongs to the target.
  if (!binary) {
    failures.push('ready.json has no binary field')
  } else if (pinnedBinary) {
    if (!samePath(binary, pinnedBinary)) {
      failures.push(
        `asked for --chromium-binary ${pinnedBinary}, ran ${binary}`
      )
    }

    if (ready.binaryProvenance !== 'pinned') {
      failures.push(
        `binaryProvenance is ${ready.binaryProvenance || 'missing'}, expected pinned`
      )
    }
  } else {
    const wrongName = !identity.binary.test(binary)
    const wrongCache = !identity.managedAllowed && isInside(binary, cacheRoot)
    const wrongChrome =
      browser !== 'chrome' && /chrome for testing/i.test(binary)

    if (wrongName || wrongCache || wrongChrome) {
      failures.push(
        `asked for ${target}, ran ${binary} (${ready.binaryProvenance || 'no provenance'}${
          wrongCache ? ', from the managed cache' : ''
        })`
      )
    }
  }

  // b. The pid is alive and its executable is that binary.
  const pid = ready.browserPid
  let liveExe = null

  if (typeof pid !== 'number') {
    failures.push('ready.json has no browserPid')
  } else if (!pidAlive(pid)) {
    failures.push(`browserPid ${pid} is not alive`)
  } else {
    liveExe = executableOfPid(pid)

    if (!liveExe) {
      notes.push(`could not read the executable of pid ${pid} on this platform`)
    } else if (!samePath(liveExe, binary)) {
      const sameBundle =
        appBundleOf(liveExe) &&
        appBundleOf(binary) &&
        samePath(appBundleOf(liveExe), appBundleOf(binary))

      if (sameBundle) {
        notes.push(`pid ${pid} runs ${liveExe}, same bundle as ${binary}`)
      } else {
        failures.push(
          `browserPid ${pid} runs ${liveExe}, but ready.json names ${binary}`
        )
      }
    }
  }

  // c. The card names the target and the version the app reports for itself.
  if (!card) {
    failures.push('no Browser row found on the card')
  } else {
    if (!pinnedBinary && !identity.card.test(card)) {
      failures.push(`card says "${card}", asked for ${target}`)
    }

    const cardVersion = numericVersion(card)
    const appVersion = binary ? numericVersion(versionOfBinary(binary)) : ''

    if (!cardVersion) {
      notes.push(`card row "${card}" carries no version`)
    } else if (!appVersion) {
      notes.push(`could not read a version off ${binary}`)
    } else if (
      cardVersion !== appVersion &&
      !appVersion.startsWith(`${cardVersion}.`) &&
      !cardVersion.startsWith(`${appVersion}.`)
    ) {
      failures.push(`card says ${cardVersion}, ${binary} reports ${appVersion}`)
    }
  }

  // d. The extension is loaded in that browser.
  if (CHROMIUM_FAMILY.has(browser)) {
    const attached = ready.runtime === 'attached'
    const prefs = chromiumExtensionEnabled(ready)

    if (prefs.checked && !prefs.ok) {
      failures.push(`extension is present but ${prefs.reason}`)
    } else if (!attached && !prefs.checked) {
      failures.push(
        `no proof the extension loaded: runtime=${ready.runtime || 'unset'}, ${prefs.reason}`
      )
    }
  } else if (typeof ready.rdpPort !== 'number') {
    failures.push('no rdpPort in ready.json, the add-on install never answered')
  }

  // e. Nothing of the browser's own is in front of the reader.
  let pages = null

  let listingFailed = false

  try {
    pages = await foregroundPages({browser, ready, cli, projectDir})
  } catch (error) {
    // A listing that cannot answer is a failure, not a skip: the check
    // passed vacuously on every gecko target while the session ran without
    // --allow-control, and nothing said so.
    listingFailed = true
    failures.push(
      `could not list the browser's pages: ${String(error?.message || error)}`
    )
  }

  if (pages === null) {
    if (!listingFailed) {
      notes.push('no page listing for this target, on-screen check skipped')
    }
  } else {
    const ownIds = ownExtensionIds(ready)
    const foreign = pages.filter((page) => !isOwnOrBlankPage(page.url, ownIds))

    if (foreign.length) {
      failures.push(
        `${target} put its own page in front of the extension: ${foreign
          .map((page) => page.url)
          .join(', ')}`
      )
    }

    notes.push(
      `${pages.length} page(s) on screen: ${pages.map((page) => page.url).join(', ') || 'none'}`
    )
  }

  return {
    failures,
    notes,
    binary,
    provenance: ready.binaryProvenance || '',
    card,
    pid,
    liveExe
  }
}

function classifyEarlyExit(session) {
  const text = stripAnsi(session.output)

  // Gecko says "<Fork> isn't installed.", Chromium says "Can't find the
  // <Fork> binary." Both mean the target is absent on this machine.
  const notInstalled = /isn't installed|can't find the \w+ binary/i

  if (notInstalled.test(text)) {
    const line = text.split(/\r?\n/).find((l) => notInstalled.test(l))

    return {status: 'SKIP', reason: (line || 'not installed').trim()}
  }

  if (/keeps remote debugging off/i.test(text)) {
    return {
      status: 'PASS',
      reason:
        'refused by design: LibreWolf keeps remote debugging off without its overrides file, nothing launched'
    }
  }

  return null
}

async function runTarget({
  target,
  projectDir,
  cli,
  cacheRoot,
  cacheLabel,
  env
}) {
  const browser = target === 'chromium-binary' ? 'chromium' : target
  // --allow-control lets the on-screen check ask a gecko session for its
  // tabs through the CLI's own inspect verb; it changes nothing else here.
  const devArgs = [`--browser=${browser}`, '--allow-control']
  const pinnedBinary = target === 'chromium-binary' ? chromiumBinary : ''
  if (pinnedBinary) devArgs.push(`--chromium-binary=${pinnedBinary}`)

  // A fresh contract per run: a stale one from the previous cache mode
  // would satisfy the poll before this browser even started.
  rmSync(join(projectDir, 'dist', 'extension-js', browser), {
    recursive: true,
    force: true
  })

  console.log(`\n▶ ${target} (${cacheLabel} cache)`)
  const session = await runDevSession({
    projectDir,
    browser,
    devArgs,
    env,
    cli,
    inspect: (live) =>
      assertIdentity({
        target,
        browser,
        session: live,
        cacheRoot,
        pinnedBinary,
        cli,
        projectDir
      })
  })

  if (session.outcome !== 'ready') {
    const early = classifyEarlyExit(session)

    if (early && session.outcome === 'exited') {
      console.log(`  ${early.status}: ${early.reason}`)

      return {target, cacheLabel, status: early.status, detail: early.reason}
    }

    const detail =
      session.outcome === 'timeout'
        ? `timed out after ${timeoutMs} ms at stage "${session.stage}"`
        : session.outcome === 'contract-error'
          ? `ready.json reported ${session.ready?.code || 'error'}: ${session.ready?.message || ''}`
          : `dev exited with code ${session.exitCode} before the browser was ready`
    console.log(`  FAIL: ${detail}\n${tail(session.output)}`)

    return {target, cacheLabel, status: 'FAIL', detail}
  }

  const verdict = session.verdict

  for (const note of verdict.notes) console.log(`  note: ${note}`)

  if (verdict.failures.length) {
    for (const failure of verdict.failures) console.log(`  FAIL: ${failure}`)

    return {
      target,
      cacheLabel,
      status: 'FAIL',
      detail: verdict.failures.join('; '),
      ...verdict
    }
  }

  console.log(
    `  PASS: ${verdict.card} ran ${verdict.binary} (${verdict.provenance || 'no provenance'}), pid ${verdict.pid}`
  )

  return {target, cacheLabel, status: 'PASS', detail: '', ...verdict}
}

function printSummary(rows) {
  console.log('\nBrowser identity summary')
  console.log('target            cache  result  binary')

  for (const row of rows) {
    const what =
      row.status === 'PASS' && row.binary
        ? `${row.binary} (${row.provenance || '?'})`
        : row.detail
    console.log(
      `${row.target.padEnd(17)} ${row.cacheLabel.padEnd(6)} ${row.status.padEnd(7)} ${what}`
    )
  }

  const skipped = rows.filter((row) => row.status === 'SKIP')

  if (skipped.length) {
    console.log(
      `\nSkipped, not installed here: ${skipped.map((row) => row.target).join(', ')}. Install them to cover them.`
    )
  }
}

async function main() {
  if (!['warm', 'cold', 'both'].includes(cacheMode)) {
    throw new Error(`--cache must be warm, cold or both, got ${cacheMode}`)
  }

  const targets = [...requested]

  for (const target of targets) {
    if (!IDENTITY[target]) {
      throw new Error(
        `Unknown target ${target}. Known: ${Object.keys(IDENTITY).join(', ')}`
      )
    }
  }

  if (chromiumBinary) {
    if (!existsSync(chromiumBinary)) {
      throw new Error(`--chromium-binary does not exist: ${chromiumBinary}`)
    }

    targets.push('chromium-binary')
  }

  const root = mkdtempSync(join(tmpdir(), 'extjs-browser-identity-'))
  const projectDir = join(root, 'my-extension')
  console.log(`Using temp root: ${root}`)

  const rows = []

  try {
    // The documented sequence, exactly as a reader types it.
    if (useLocalCli) {
      const createCli = resolveRepoCli()
      console.log(
        `Creating with the repo CLI: ${createCli.cliPath} create my-extension`
      )

      await runCollect(...cliSpawnArgs(createCli, ['create', 'my-extension']), {
        cwd: root
      })
    } else {
      console.log(`Creating with: npx -y ${pkg} create my-extension`)
      await runCollect('npx', ['-y', pkg, 'create', 'my-extension'], {
        cwd: root,
        shell: process.platform === 'win32'
      })
    }

    console.log('Installing: npm install')
    await runCollect('npm', ['install'], {
      cwd: projectDir,
      shell: process.platform === 'win32'
    })

    const cli = resolveDevCli({projectDir, useRepoBuild: useLocalCli})
    console.log(`Running dev with the CLI from ${describeDevCli(cli)}`)

    const modes = cacheMode === 'both' ? ['cold', 'warm'] : [cacheMode]

    for (const mode of modes) {
      let env = baseEnv
      let cacheRoot = managedCacheRoot(baseEnv)

      if (mode === 'cold') {
        // An empty cache is the state in which the fork fallback can never
        // fire, so a cold pass alone proves nothing about 501; it proves the
        // first-run path. The warm pass is the one that catches it.
        cacheRoot = join(root, 'cold-cache')
        mkdirSync(cacheRoot, {recursive: true})
        env = {...baseEnv, EXT_BROWSERS_CACHE_DIR: cacheRoot}
        console.log(`\nCold pass: managed cache redirected to ${cacheRoot}`)
      } else if (!managedCacheIsWarm(cacheRoot)) {
        console.log(
          `\nWARN: the managed cache at ${cacheRoot} is empty, so a fork falling back to a managed browser cannot be observed. Run a managed target (chrome, firefox) first, or pass --cache both.`
        )
      } else {
        console.log(`\nWarm pass: managed cache at ${cacheRoot}`)
      }

      for (const target of targets) {
        rows.push(
          await runTarget({
            target,
            projectDir,
            cli,
            cacheRoot,
            cacheLabel: mode,
            env
          })
        )
      }
    }
  } finally {
    printSummary(rows)

    if (!keepTemp) {
      try {
        rmSync(root, {recursive: true, force: true})
      } catch (error) {
        console.warn(`Cleanup warning for ${root}: ${String(error)}`)
      }
    } else {
      console.log(`Temp directory preserved: ${root}`)
    }
  }

  const failed = rows.filter((row) => row.status === 'FAIL')

  if (failed.length) {
    throw new Error(
      `${failed.length} target(s) did not run the browser they claim: ${failed
        .map((row) => `${row.target} (${row.detail})`)
        .join('; ')}`
    )
  }

  console.log(
    `\nPASS: ${rows.filter((row) => row.status === 'PASS').length} target(s) ran the browser the card names`
  )
}

main().catch((error) => {
  console.error('FAIL: browser identity validation failed')
  console.error(String(error?.stack || error))
  process.exit(1)
})
