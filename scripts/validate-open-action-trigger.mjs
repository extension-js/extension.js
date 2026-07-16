// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

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
  // Support both `--name value` and `--name=value`.
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
const timeoutMs = Number(parseArg('--timeout-ms', '180000'))
const keepTemp = parseFlag('--keep-temp')
const cliBin = resolve(
  parseArg('--bin', join(repoRoot, 'programs/extension/bin/extension.cjs'))
)

const MARKER = 'SMOKE_ACTION_FIRED'
const COMMAND_NAME = 'smoke-command'

const childEnv = {
  ...process.env,
  EXTENSION_AUTHOR_MODE: 'true'
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

function writeFixture(dir) {
  const manifest = {
    manifest_version: 3,
    name: 'Smoke Open Action',
    version: '1.0',
    description: 'No-popup toolbar action used to validate `open action`.',
    background: {service_worker: 'background.js'},
    // An empty `action` declares a toolbar button with NO default_popup, so a
    // click fires chrome.action.onClicked — exactly the path under test.
    action: {},
    // A keyboard-shortcut command whose onCommand handler we replay via
    // `open command` (the shortcut itself is never pressed).
    commands: {
      [COMMAND_NAME]: {
        suggested_key: {default: 'Ctrl+Shift+Y'},
        description: 'Smoke command'
      }
    },
    permissions: ['storage']
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({name: 'smoke-open-action', version: '1.0.0'}, null, 2)
  )
  writeFileSync(
    join(dir, 'background.js'),
    [
      'chrome.action.onClicked.addListener(async () => {',
      `  await chrome.storage.local.set({smokeClicked: '${MARKER}'})`,
      `  console.log('${MARKER}')`,
      '})',
      'chrome.commands.onCommand.addListener(async (command) => {',
      '  await chrome.storage.local.set({smokeCommand: command})',
      "  console.log('SMOKE_COMMAND_FIRED', command)",
      '})',
      ''
    ].join('\n')
  )
}

function startDev(cwd) {
  const child = spawn(
    process.execPath,
    [cliBin, 'dev', `--browser=${browser}`, '--allow-control'],
    {cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe']}
  )
  let output = ''

  child.stdout.on('data', (c) => (output += c.toString()))
  child.stderr.on('data', (c) => (output += c.toString()))

  return {child, getOutput: () => output}
}

async function waitForReady(projectDir) {
  const readyPath = join(
    projectDir,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    if (existsSync(readyPath)) {
      try {
        const payload = JSON.parse(readFileSync(readyPath, 'utf8'))
        if (payload.status === 'ready') return payload

        if (payload.status === 'error') {
          throw new Error(
            `dev reported error: ${payload.message || payload.errors?.[0] || 'unknown'}`
          )
        }
      } catch (err) {
        if (String(err.message || '').startsWith('dev reported error'))
          throw err
        // partial write — retry
      }
    }

    await new Promise((r) => setTimeout(r, 300))
  }

  throw new Error(`ready.json never reached "ready" within ${timeoutMs}ms`)
}

// `ready.json` flips to "ready" when the build + browser launch are done, but
// the background service worker connects to the control bridge a moment later.
// Poll a read-only bridge command until the executor (the SW) is connected.
async function waitForExecutor(projectDir) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await runCli(
      [
        'storage',
        'get',
        projectDir,
        '--key',
        '__extjs_executor_probe__',
        `--browser=${browser}`,
        '--output',
        'json'
      ],
      {cwd: repoRoot}
    ).catch(() => null)
    if (res) {
      try {
        if (parseJsonResult(res.stdout, 'executor probe').ok) return
      } catch {
        // not JSON yet — keep polling
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(
    `bridge executor (service worker) never connected within ${timeoutMs}ms`
  )
}

function parseJsonResult(stdout, label) {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()
    .find((l) => l.startsWith('{'))
  if (!line) {
    throw new Error(`${label}: no JSON result in output:\n${stdout}`)
  }

  return JSON.parse(line)
}

async function main() {
  if (!existsSync(cliBin)) {
    throw new Error(
      `CLI not found at ${cliBin}. Build it first (e.g. \`pnpm --dir programs/extension build\`) or pass --bin.`
    )
  }

  const root = mkdtempSync(join(tmpdir(), 'extjs-open-action-'))
  const projectDir = join(root, 'smoke-open-action')

  mkdirSync(projectDir, {recursive: true})
  writeFixture(projectDir)

  console.log(`Fixture: ${projectDir} (browser=${browser})`)

  const dev = startDev(projectDir)
  try {
    console.log('Booting dev and waiting for ready.json...')

    await waitForReady(projectDir)
    console.log('PASS: dev session is ready')

    await waitForExecutor(projectDir)
    console.log('PASS: bridge executor (service worker) connected')

    // 1) Trigger the action — must fire the no-popup onClicked path.
    const trigger = await runCli(
      [
        'open',
        'action',
        projectDir,
        `--browser=${browser}`,
        '--output',
        'json'
      ],
      {cwd: repoRoot}
    )
    const triggerResult = parseJsonResult(trigger.stdout, 'open action')

    if (!triggerResult.ok || triggerResult.value?.triggered !== 'onClicked') {
      throw new Error(
        `open action did not fire onClicked. Got: ${JSON.stringify(triggerResult)}`
      )
    }

    if (!(triggerResult.value.listeners >= 1)) {
      throw new Error(
        `open action fired 0 listeners (expected >=1): ${JSON.stringify(triggerResult)}`
      )
    }

    console.log(
      `PASS: open action fired onClicked (${triggerResult.value.listeners} listener(s))`
    )

    // 2) Prove the listener actually ran by reading its storage side-effect.
    const read = await runCli(
      [
        'storage',
        'get',
        projectDir,
        '--key',
        'smokeClicked',
        `--browser=${browser}`,
        '--output',
        'json'
      ],
      {cwd: repoRoot}
    )
    const readResult = parseJsonResult(read.stdout, 'storage get')

    if (readResult.value?.smokeClicked !== MARKER) {
      throw new Error(
        `onClicked listener did not run — storage marker missing. Got: ${JSON.stringify(readResult)}`
      )
    }

    console.log('PASS: onClicked listener executed (storage marker present)')

    // 3) Trigger a keyboard-shortcut command and verify its handler ran.
    const triggerCmd = await runCli(
      [
        'open',
        'command',
        projectDir,
        '--name',
        COMMAND_NAME,
        `--browser=${browser}`,
        '--output',
        'json'
      ],
      {cwd: repoRoot}
    )
    const cmdResult = parseJsonResult(triggerCmd.stdout, 'open command')
    if (
      !cmdResult.ok ||
      cmdResult.value?.triggered !== 'command' ||
      cmdResult.value?.command !== COMMAND_NAME ||
      !(cmdResult.value?.listeners >= 1)
    ) {
      throw new Error(
        `open command did not fire onCommand. Got: ${JSON.stringify(cmdResult)}`
      )
    }
    console.log(
      `PASS: open command fired onCommand "${COMMAND_NAME}" (${cmdResult.value.listeners} listener(s))`
    )

    const readCmd = await runCli(
      [
        'storage',
        'get',
        projectDir,
        '--key',
        'smokeCommand',
        `--browser=${browser}`,
        '--output',
        'json'
      ],
      {cwd: repoRoot}
    )
    const readCmdResult = parseJsonResult(
      readCmd.stdout,
      'storage get (command)'
    )
    if (readCmdResult.value?.smokeCommand !== COMMAND_NAME) {
      throw new Error(
        `onCommand listener did not run — storage marker missing. Got: ${JSON.stringify(readCmdResult)}`
      )
    }
    console.log('PASS: onCommand listener executed (storage marker present)')

    console.log(
      'SMOKE PASSED: open action → onClicked, open command → onCommand, both side-effects verified'
    )
  } finally {
    try {
      dev.child.kill('SIGTERM')
      setTimeout(() => {
        try {
          dev.child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, 1000)
    } catch {
      // ignore
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

main().catch((error) => {
  console.error('FAIL: open action trigger smoke failed')
  console.error(String(error?.stack || error))
  process.exit(1)
})
