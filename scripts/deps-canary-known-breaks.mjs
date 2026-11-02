#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import process from 'node:process'
import {pathToFileURL} from 'node:url'

// A canary leg exists to catch upstream breaks early. Once one is caught,
// understood and fixed upstream but not yet released, the lane would stay red
// every week for a reason nobody here can act on, and a second, real break
// would hide behind it. Each entry names one such break by the exact text it
// prints, so only that failure is allowed; any other red still opens the
// issue. An entry whose leg runs green again asks to be deleted.
export const KNOWN_UPSTREAM_BREAKS = [
  {
    leg: 'typescript-next',
    name: 'rsbuild-plugin-dts calls getExePath() with no argument',
    signature: 'Failed to resolve the native TypeScript executable',
    upstream: [
      'https://github.com/microsoft/TypeScript/pull/64174',
      'https://github.com/web-infra-dev/rslib/pull/1993'
    ],
    retire:
      'an rsbuild-plugin-dts release after 1.0.5 carries rslib#1993 and the lockfile takes it'
  }
]

export function findKnownBreak(leg, log, breaks = KNOWN_UPSTREAM_BREAKS) {
  return (
    breaks.find(
      (entry) => entry.leg === leg && String(log).includes(entry.signature)
    ) || null
  )
}

export function classify({leg, outcome, log}, breaks = KNOWN_UPSTREAM_BREAKS) {
  if (outcome === 'success') {
    const stale = breaks.filter((entry) => entry.leg === leg)

    return {
      exitCode: 0,
      lines: stale.map(
        (entry) =>
          `::notice title=Known upstream break no longer reproduces on ${leg}::` +
          `"${entry.name}" did not fail this run. Delete its entry in ` +
          `scripts/deps-canary-known-breaks.mjs (retire when ${entry.retire}).`
      )
    }
  }

  const known = findKnownBreak(leg, log, breaks)

  if (!known) {
    return {
      exitCode: 1,
      lines: [
        `::error title=Dependency canary ${leg} is red::the failure matches ` +
          'no known upstream break, so it is reported as ours to read.'
      ]
    }
  }

  return {
    exitCode: 0,
    upstream: known.name,
    lines: [
      `::warning title=Upstream break on ${leg}::${known.name}. ` +
        `Not an Extension.js defect, allowed until ${known.retire}. ` +
        `Upstream: ${known.upstream.join(' ')}`
    ]
  }
}

export function main(argv = process.argv.slice(2)) {
  const [leg, outcome, logPath] = argv

  if (!leg || !['success', 'failure'].includes(outcome)) {
    console.error(
      'usage: node scripts/deps-canary-known-breaks.mjs <leg> <success|failure> [log]'
    )

    return 2
  }

  const log =
    logPath && fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
  const result = classify({leg, outcome, log})

  for (const line of result.lines) console.log(line)

  if (result.upstream && process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `upstream=${result.upstream}\n`
    )
  }

  if (result.upstream && process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### Upstream break, allowed\n\n${result.lines[0].replace(/^::warning title=[^:]+::/, '')}\n`
    )
  }

  return result.exitCode
}

if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).toString()
) {
  process.exitCode = main()
}
