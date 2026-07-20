// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Session-lifecycle exercise: runs the control channel through the process
// boundaries no unit spec crosses, dev-server crash + restart against a
// profile whose cached service worker has the OLD port/instanceId baked in
// (issue #484), dist wipes under a kept profile, two-browser sessions on one
// project (the eval-token clobber), and MV3 idle windows. Drives everything
// through CLI verbs on purpose: the fresh-process contract/token reads are
// part of what is under test.
//
// Usage:
//   node scripts/validate-session-lifecycle.mjs [--scenario <name,...|all>]
//     [--browser chromium] [--second-browser chrome] [--timeout-ms 180000]
//     [--keep-temp] [--bin <path>]
//
// Default scenarios: baseline,restart-kept-profile,dist-wipe-kept-profile
// (~3-5 min). `all` adds two-browser (downloads the pinned chrome on first
// run) and idle-window (~2 min of sleeps). restart-port-lost is a
// non-gating probe, run only when named explicitly.
// Headless: EXTENSION_BROWSER_FLAGS="--headless=new" (honored from the env).

import {spawn} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const args = process.argv.slice(2)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)

  const idx = args.indexOf(name)
  if (idx === -1) return fallback

  const next = args[idx + 1]
  if (!next || next.startsWith('--')) return fallback

  return next
}

const parseFlag = (name) => args.includes(name)

const browser = parseArg('--browser', 'chromium')
const secondBrowser = parseArg('--second-browser', 'chrome')
const timeoutMs = Number(parseArg('--timeout-ms', '180000'))
const keepTemp = parseFlag('--keep-temp')
const cliBin = resolve(
  parseArg('--bin', join(repoRoot, 'programs/extension/bin/extension.cjs'))
)

const DEFAULT_SCENARIOS = [
  'baseline',
  'restart-kept-profile',
  'dist-wipe-kept-profile'
]
const ALL_SCENARIOS = [...DEFAULT_SCENARIOS, 'two-browser', 'idle-window']

const childEnv = {
  ...process.env,
  // Author mode surfaces the broker's "stale producer → full-reload resync"
  // log line, one of the two accepted resync signals.
  EXTENSION_AUTHOR_MODE: 'true'
}

// Every spawned dev session, for the end-of-run sweep, a SIGKILLed scenario
// must not leak browsers into the next one (or into CI).
const liveSessions = new Set()

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function runCli(cliArgs, {cwd, timeout = 30000} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cliBin, ...cliArgs], {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const killer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      rejectPromise(
        new Error(
          `[extension ${cliArgs.join(' ')}] timed out after ${timeout}ms`
        )
      )
    }, timeout)

    child.stdout.on('data', (c) => (stdout += c.toString()))
    child.stderr.on('data', (c) => (stderr += c.toString()))
    child.on('error', (err) => {
      clearTimeout(killer)
      rejectPromise(err)
    })
    child.on('close', (code) => {
      clearTimeout(killer)
      resolvePromise({code: code || 0, stdout, stderr})
    })
  })
}

function parseJsonResult(stdout, label) {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()
    .find((l) => l.startsWith('{') || l.startsWith('['))
  if (!line) {
    throw new Error(`${label}: no JSON result in output:\n${stdout}`)
  }

  return JSON.parse(line)
}

function writeFixture(dir) {
  const manifest = {
    manifest_version: 3,
    name: 'Session Lifecycle Fixture',
    version: '1.0',
    description: 'Fixture for the control-channel session-lifecycle exercise.',
    background: {service_worker: 'background.js'},
    permissions: ['storage']
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {name: 'session-lifecycle-fixture', version: '1.0.0'},
      null,
      2
    )
  )
  // Top-level SW code runs on every worker start, including the full-reload
  // a stale worker is told to perform on resync, so the counter advancing
  // proves fresh code ran after a restart, whichever way Chrome got there.
  writeFileSync(
    join(dir, 'background.js'),
    [
      ';(async () => {',
      "  const {swBootCount = 0} = await chrome.storage.local.get('swBootCount')",
      '  await chrome.storage.local.set({swBootCount: swBootCount + 1})',
      '})()',
      ''
    ].join('\n')
  )
}

function startDev(cwd, {browserName = browser, profile} = {}) {
  const devArgs = [
    cliBin,
    'dev',
    `--browser=${browserName}`,
    '--allow-control',
    '--allow-eval'
  ]
  if (profile) devArgs.push('--profile', profile)

  // Detached → own process group, so kills reach the launched browser too.
  const child = spawn(process.execPath, devArgs, {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  })
  let output = ''
  child.stdout.on('data', (c) => (output += c.toString()))
  child.stderr.on('data', (c) => (output += c.toString()))

  const session = {child, browserName, getOutput: () => output}
  liveSessions.add(session)
  child.on('close', () => liveSessions.delete(session))

  return session
}

function killGroup(session, signal) {
  try {
    process.kill(-session.child.pid, signal)
  } catch {
    try {
      session.child.kill(signal)
    } catch {
      // already gone
    }
  }
}

function waitExit(child, ms) {
  return new Promise((resolvePromise) => {
    if (child.exitCode != null) return resolvePromise(true)
    const timer = setTimeout(() => resolvePromise(false), ms)
    child.once('close', () => {
      clearTimeout(timer)
      resolvePromise(true)
    })
  })
}

/** Orderly shutdown: SIGTERM the group, escalate to SIGKILL. */
async function stopClean(session) {
  killGroup(session, 'SIGTERM')
  const exited = await waitExit(session.child, 5000)
  if (!exited) killGroup(session, 'SIGKILL')
  await waitExit(session.child, 2000)
}

/** Crash simulation: no cleanup handlers run, ready.json, the persisted
 * port file, and the browser profile are all left behind, which is exactly
 * the state the restart scenarios need. */
async function killUnclean(session) {
  killGroup(session, 'SIGKILL')
  await waitExit(session.child, 2000)
}

function readyPath(projectDir, browserName) {
  return join(projectDir, 'dist', 'extension-js', browserName, 'ready.json')
}

// After an UNCLEAN kill the previous session's ready.json survives, still
// saying "ready", polling would happily return the corpse. Callers that
// restart pass the dead session's instanceId so only the NEW contract counts.
async function waitForReady(
  projectDir,
  browserName = browser,
  {rejectInstanceId} = {}
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (existsSync(readyPath(projectDir, browserName))) {
      try {
        const payload = JSON.parse(
          readFileSync(readyPath(projectDir, browserName), 'utf8')
        )
        if (rejectInstanceId && payload.instanceId === rejectInstanceId) {
          throw new Error('stale contract')
        }
        if (payload.status === 'ready') return payload
        if (payload.status === 'error') {
          throw new Error(
            `dev reported error: ${payload.message || payload.errors?.[0] || 'unknown'}`
          )
        }
      } catch (err) {
        if (String(err.message || '').startsWith('dev reported error'))
          throw err
        // partial write, retry
      }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(
    `ready.json (${browserName}) never reached "ready" within ${timeoutMs}ms`
  )
}

// ready.json flips before the SW connects to the bridge; poll a read-only
// verb until the executor answers. Also the resync assertion for the restart
// scenarios: only a live (possibly freshly full-reloaded) SW can answer.
async function waitForExecutor(projectDir, browserName = browser) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await runCli(
      [
        'storage',
        'get',
        projectDir,
        '--key',
        '__extjs_executor_probe__',
        `--browser=${browserName}`,
        '--output',
        'json'
      ],
      {cwd: repoRoot}
    ).catch(() => null)
    if (res) {
      try {
        if (parseJsonResult(res.stdout, 'executor probe').ok) return
      } catch {
        // not JSON yet, keep polling
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(
    `bridge executor (${browserName} service worker) never connected within ${timeoutMs}ms`
  )
}

async function actJson(verbArgs, label) {
  const res = await runCli([...verbArgs, '--output', 'json'], {cwd: repoRoot})
  return parseJsonResult(res.stdout, label)
}

async function readStorageKey(projectDir, key, browserName = browser) {
  const result = await actJson(
    ['storage', 'get', projectDir, '--key', key, `--browser=${browserName}`],
    `storage get ${key}`
  )
  assert(result.ok, `storage get ${key} failed: ${JSON.stringify(result)}`)
  return result.value?.[key]
}

async function assertVerbsWork(projectDir, browserName = browser) {
  const set = await actJson(
    [
      'storage',
      'set',
      projectDir,
      '--key',
      'lifecycleMarker',
      '--value',
      '"alive"',
      `--browser=${browserName}`
    ],
    'storage set'
  )
  assert(set.ok, `storage set failed: ${JSON.stringify(set)}`)

  const marker = await readStorageKey(
    projectDir,
    'lifecycleMarker',
    browserName
  )
  assert(marker === 'alive', `storage round-trip lost the value: ${marker}`)

  // What this gates is the eval PIPELINE: token accepted (a Forbidden here
  // is the token-clobber regression) and the command routed to a live
  // executor (Unavailable = no executor). MV3 Chromium then refuses the
  // actual evaluation by CSP with a documented Unsupported, that outcome
  // still proves both legs under test.
  const evalResult = await actJson(
    ['eval', '1 + 1', projectDir, `--browser=${browserName}`],
    'eval'
  )
  const evalPipelineOk =
    (evalResult.ok && evalResult.value === 2) ||
    evalResult.error?.name === 'Unsupported'
  assert(
    evalPipelineOk,
    `eval did not clear the token gate + executor routing: ${JSON.stringify(evalResult)}`
  )

  const reload = await actJson(
    ['reload', projectDir, `--browser=${browserName}`],
    'reload'
  )
  assert(reload.ok, `reload failed: ${JSON.stringify(reload)}`)
  await waitForExecutor(projectDir, browserName)
}

async function runDoctor(projectDir, browserName = browser) {
  const res = await runCli(
    ['doctor', projectDir, `--browser=${browserName}`, '--output', 'json'],
    {cwd: repoRoot}
  )
  return {checks: parseJsonResult(res.stdout, 'doctor'), code: res.code}
}

function controlPortFile(projectDir, browserName) {
  return join(projectDir, '.extension-js', `control-port-${browserName}`)
}

function controlTokenFile(projectDir, browserName) {
  return join(projectDir, '.extension-js', `control-token-${browserName}`)
}

function makeProject(root, name) {
  const projectDir = join(root, name)
  mkdirSync(projectDir, {recursive: true})
  writeFixture(projectDir)
  return projectDir
}

// --- scenarios ---

async function scenarioBaseline({root}) {
  const projectDir = makeProject(root, 'baseline')
  const session = startDev(projectDir)
  try {
    const ready = await waitForReady(projectDir)
    await waitForExecutor(projectDir)

    await assertVerbsWork(projectDir)

    const persistedPort = Number(
      readFileSync(controlPortFile(projectDir, browser), 'utf8').trim()
    )
    assert(
      persistedPort === ready.controlPort,
      `persisted port ${persistedPort} != contract port ${ready.controlPort}`
    )
    assert(
      existsSync(controlTokenFile(projectDir, browser)),
      'eval token file missing despite --allow-eval'
    )

    const doctor = await runDoctor(projectDir)
    assert(
      doctor.code === 0 && doctor.checks.every((c) => c.status !== 'fail'),
      `doctor reported failures on a healthy session: ${JSON.stringify(doctor.checks)}`
    )
  } finally {
    await stopClean(session)
  }
}

// The #484 repro: crash the server (no cleanup), restart on the same
// project, and require the persisted-port preference + stale-SW resync
// contract to deliver a working executor. Needs an EXPLICIT profile: the
// default managed profile is fresh per session, and #484 exists precisely
// because real profiles (and their cached SW + storage) outlive the server.
async function scenarioRestartKeptProfile({root}) {
  const projectDir = makeProject(root, 'restart')
  const profileDir = join(root, 'kept-profile')
  mkdirSync(profileDir, {recursive: true})
  const first = startDev(projectDir, {profile: profileDir})
  let second = null
  try {
    const ready1 = await waitForReady(projectDir)
    await waitForExecutor(projectDir)
    const boots1 = await readStorageKey(projectDir, 'swBootCount')
    assert(boots1 >= 1, `SW boot counter never wrote (got ${boots1})`)

    await killUnclean(first)

    // Doctor must name the crash: live-looking contract, dead pid.
    const postCrash = await runDoctor(projectDir)
    const serverCheck = postCrash.checks.find(
      (c) => c.check === 'server-process'
    )
    assert(
      serverCheck?.status === 'fail',
      `doctor missed the dead dev server: ${JSON.stringify(postCrash.checks)}`
    )

    second = startDev(projectDir, {profile: profileDir})
    const ready2 = await waitForReady(projectDir, browser, {
      rejectInstanceId: ready1.instanceId
    })

    assert(
      ready2.controlPort === ready1.controlPort,
      `restart did not prefer the persisted port (was ${ready1.controlPort}, now ${ready2.controlPort}), a profile-cached SW would dial a dead port forever`
    )
    assert(
      ready2.instanceId !== ready1.instanceId,
      'restart reused the instanceId, stale-SW detection would be blind'
    )

    // Only a resynced (or relaunch-refreshed) SW can answer this.
    await waitForExecutor(projectDir)

    const boots2 = await readStorageKey(projectDir, 'swBootCount')
    const sawResyncLog = second.getOutput().includes('full-reload resync')
    assert(
      boots2 > boots1 || sawResyncLog,
      `no fresh SW boot after restart (boots ${boots1} → ${boots2}, resync log: ${sawResyncLog})`
    )

    await assertVerbsWork(projectDir)
  } finally {
    if (second) await stopClean(second)
    await killUnclean(first)
  }
}

// Wipe dist/ while a profile OUTSIDE dist keeps the cached SW. The
// `.extension-js/` state must survive the wipe and rebind the port.
async function scenarioDistWipeKeptProfile({root}) {
  const projectDir = makeProject(root, 'dist-wipe')
  const profileDir = join(root, 'external-profile')
  mkdirSync(profileDir, {recursive: true})

  let session = startDev(projectDir, {profile: profileDir})
  try {
    const ready1 = await waitForReady(projectDir)
    await waitForExecutor(projectDir)
    const boots1 = await readStorageKey(projectDir, 'swBootCount')

    await stopClean(session)
    rmSync(join(projectDir, 'dist'), {recursive: true, force: true})

    session = startDev(projectDir, {profile: profileDir})
    const ready2 = await waitForReady(projectDir)
    assert(
      ready2.controlPort === ready1.controlPort,
      `port not rebound across a dist wipe (was ${ready1.controlPort}, now ${ready2.controlPort}), .extension-js state did not survive`
    )

    await waitForExecutor(projectDir)
    const boots2 = await readStorageKey(projectDir, 'swBootCount')
    assert(
      boots2 > boots1,
      `SW never re-ran after the dist wipe (boots ${boots1} → ${boots2})`
    )

    await assertVerbsWork(projectDir)
  } finally {
    await stopClean(session)
  }
}

// Two browsers, one project: the reporter's A/B. Per-browser session state
// (ports, tokens) must keep BOTH sessions' verbs working, and an unclean
// death of one must not break the other.
async function scenarioTwoBrowser({root}) {
  const install = await runCli(['install', secondBrowser], {
    cwd: repoRoot,
    timeout: 300000
  }).catch(() => null)
  if (!install || install.code !== 0) {
    return {
      skipped: `could not install the pinned ${secondBrowser} binary, run \`extension install ${secondBrowser}\` and re-run`
    }
  }

  const projectDir = makeProject(root, 'two-browser')
  const a = startDev(projectDir, {browserName: browser})
  let b = null
  try {
    await waitForReady(projectDir, browser)
    await waitForExecutor(projectDir, browser)
    await assertVerbsWork(projectDir, browser)

    b = startDev(projectDir, {browserName: secondBrowser})
    await waitForReady(projectDir, secondBrowser)
    await waitForExecutor(projectDir, secondBrowser)

    // The clobber regression: session B's start must not invalidate A's
    // eval token, and each browser keeps its own.
    await assertVerbsWork(projectDir, secondBrowser)
    await assertVerbsWork(projectDir, browser)

    const tokenA = readFileSync(controlTokenFile(projectDir, browser), 'utf8')
    const tokenB = readFileSync(
      controlTokenFile(projectDir, secondBrowser),
      'utf8'
    )
    assert(tokenA !== tokenB, 'per-browser tokens are identical, shared slot?')

    await killUnclean(b)
    b = null
    await assertVerbsWork(projectDir, browser)
  } finally {
    if (b) await killUnclean(b)
    await stopClean(a)
  }
}

// MV3 SW dormancy horizon: verbs must work FIRST TRY after idle windows,
// this gates the producer keepalive contract.
async function scenarioIdleWindow({root}) {
  const projectDir = makeProject(root, 'idle')
  const session = startDev(projectDir)
  try {
    await waitForReady(projectDir)
    await waitForExecutor(projectDir)

    console.log('  idling 60s (no control traffic)...')
    await new Promise((r) => setTimeout(r, 60_000))

    const get = await actJson(
      [
        'storage',
        'get',
        projectDir,
        '--key',
        'swBootCount',
        `--browser=${browser}`
      ],
      'post-idle storage get'
    )
    assert(get.ok, `first verb after 60s idle failed: ${JSON.stringify(get)}`)

    const evalResult = await actJson(
      ['eval', '2 + 2', projectDir, `--browser=${browser}`],
      'post-idle eval'
    )
    assert(
      (evalResult.ok && evalResult.value === 4) ||
        evalResult.error?.name === 'Unsupported',
      `eval after idle failed: ${JSON.stringify(evalResult)}`
    )

    console.log('  idling another 45s...')
    await new Promise((r) => setTimeout(r, 45_000))
    const reload = await actJson(
      ['reload', projectDir, `--browser=${browser}`],
      'post-idle reload'
    )
    assert(reload.ok, `reload after idle failed: ${JSON.stringify(reload)}`)
    await waitForExecutor(projectDir)
  } finally {
    await stopClean(session)
  }
}

// Non-gating probe (run only when named): what happens when the persisted
// port file is ALSO lost across a crash. Documents behavior, never fails.
async function scenarioRestartPortLost({root}) {
  const projectDir = makeProject(root, 'port-lost')
  const first = startDev(projectDir)
  let second = null
  try {
    await waitForReady(projectDir)
    await waitForExecutor(projectDir)
    await killUnclean(first)
    rmSync(controlPortFile(projectDir, browser), {force: true})

    second = startDev(projectDir)
    await waitForReady(projectDir)
    try {
      await waitForExecutor(projectDir)
      console.log('  probe: executor recovered even with the port file lost')
      // (stale-contract rejection is deliberately absent here: the probe only
      // reports whether verbs come back, however the session gets there)
    } catch {
      console.log(
        '  probe: executor did NOT recover with the port file lost (documented limitation, the persisted port is the resync path)'
      )
    }
  } finally {
    if (second) await stopClean(second)
    await killUnclean(first)
  }
  return {probe: true}
}

const SCENARIOS = {
  baseline: scenarioBaseline,
  'restart-kept-profile': scenarioRestartKeptProfile,
  'dist-wipe-kept-profile': scenarioDistWipeKeptProfile,
  'two-browser': scenarioTwoBrowser,
  'idle-window': scenarioIdleWindow,
  'restart-port-lost': scenarioRestartPortLost
}

function selectedScenarios() {
  const raw = parseArg('--scenario', DEFAULT_SCENARIOS.join(','))
  if (raw === 'all') return ALL_SCENARIOS
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const name of names) {
    if (!SCENARIOS[name]) {
      throw new Error(
        `unknown scenario "${name}" (known: ${Object.keys(SCENARIOS).join(', ')})`
      )
    }
  }
  return names
}

async function main() {
  if (process.platform === 'win32') {
    console.log(
      'session-lifecycle exercise needs POSIX process groups, skipping on win32'
    )
    return
  }
  if (!existsSync(cliBin)) {
    throw new Error(
      `CLI not found at ${cliBin}. Build it first (e.g. \`pnpm --dir programs/extension build\`) or pass --bin.`
    )
  }

  const names = selectedScenarios()
  console.log(`session-lifecycle: ${names.join(', ')} (browser=${browser})`)

  const failures = []
  for (const name of names) {
    const root = mkdtempSync(join(tmpdir(), `extjs-lifecycle-${name}-`))
    console.log(`\n=== ${name} (${root})`)
    try {
      const outcome = await SCENARIOS[name]({root})
      if (outcome?.skipped) {
        console.log(`SKIP: ${name}, ${outcome.skipped}`)
      } else {
        console.log(`PASS: ${name}`)
      }
    } catch (error) {
      console.error(`FAIL: ${name}`)
      console.error(String(error?.stack || error))
      failures.push(name)
    } finally {
      // Belt-and-suspenders: a scenario must never leak sessions.
      for (const session of [...liveSessions]) {
        killGroup(session, 'SIGKILL')
        liveSessions.delete(session)
      }
      if (keepTemp) {
        console.log(`Temp preserved: ${root}`)
      } else {
        try {
          rmSync(root, {recursive: true, force: true})
        } catch {
          // ignore
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`scenarios failed: ${failures.join(', ')}`)
  }
  console.log('\nSESSION-LIFECYCLE PASSED')
}

main().catch((error) => {
  console.error('FAIL: session-lifecycle exercise failed')
  console.error(String(error?.stack || error))
  for (const session of [...liveSessions]) {
    killGroup(session, 'SIGKILL')
  }
  process.exit(1)
})
