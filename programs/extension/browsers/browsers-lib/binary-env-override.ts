// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import locateChrome from 'chrome-location2'

type Env = Record<string, string | undefined>

const CHROME_OVERRIDES = [
  'CHROME_FOR_TESTING_PATH',
  'CHROMIUM_BINARY',
  'CHROME_BINARY'
]

// The variables that mean "run this binary" for each browser, in the order
// they are read. Chromium answers to its own name only.
export function binaryOverrideNames(browser: string): string[] {
  if (browser === 'edge') return ['EDGE_BINARY']
  if (browser === 'firefox') return ['FIREFOX_BINARY']
  if (browser === 'chrome') return CHROME_OVERRIDES
  if (browser === 'chromium') return ['CHROMIUM_BINARY']

  return []
}

export interface BinaryEnvOverride {
  name: string
  path: string
}

// The first variable the person set for this browser, whether or not the
// path exists, so a typo is caught instead of skipped.
export function binaryEnvOverride(
  browser: string,
  env: Env = process.env
): BinaryEnvOverride | null {
  for (const name of binaryOverrideNames(browser)) {
    const value = String(env[name] || '').trim()

    if (value) return {name, path: value}
  }

  return null
}

function pathKey(value: string): string {
  const resolved = path.resolve(value)

  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

// Names the variable whose value is the binary that ran, so a choice made in
// the environment is reported as a choice and not as a lucky find.
export function binaryOverrideNaming(
  browser: string,
  binaryPath: string | null | undefined,
  env: Env = process.env
): string | null {
  const binary = String(binaryPath || '').trim()
  if (!binary) return null

  for (const name of binaryOverrideNames(browser)) {
    const value = String(env[name] || '').trim()

    if (value && pathKey(value) === pathKey(binary)) return name
  }

  return null
}

// The Chrome locator reads its override from process.env on macOS and Linux,
// so the env the caller chose is lent to it for the length of one call.
export function withBinaryOverridesFrom<T>(
  env: Env,
  names: string[],
  run: () => T
): T {
  if (env === process.env) return run()

  const saved = names.map((name) => [name, process.env[name]] as const)

  const put = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  try {
    for (const name of names) put(name, env[name])

    return run()
  } finally {
    for (const [name, value] of saved) put(name, value)
  }
}

export function locateChromeIn(
  env: NodeJS.ProcessEnv,
  locate: typeof locateChrome = locateChrome
): string | null {
  return withBinaryOverridesFrom(
    env,
    CHROME_OVERRIDES,
    () => locate(true, {env}) || null
  )
}
