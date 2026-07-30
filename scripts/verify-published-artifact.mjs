#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {execFileSync} from 'node:child_process'
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

export const REQUIRED_ARTIFACT_MARKERS = [
  {
    file: 'dist/cli.cjs',
    pattern: "source: 'ci'",
    invariant:
      'telemetry reports nothing from a CI pipeline, where the first-run consent notice cannot render'
  }
]

export function findMissingMarkers(readArtifactFile, markers) {
  const required = markers || REQUIRED_ARTIFACT_MARKERS
  const missing = []

  for (const marker of required) {
    let contents = null
    try {
      contents = readArtifactFile(marker.file)
    } catch {
      contents = null
    }
    if (typeof contents !== 'string' || !contents.includes(marker.pattern)) {
      missing.push(marker)
    }
  }

  return missing
}

function getArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function fetchPublishedPackage(name, version, destination) {
  execFileSync(
    'npm',
    ['pack', `${name}@${version}`, '--pack-destination', destination],
    {
      stdio: ['ignore', 'pipe', 'inherit']
    }
  )

  const tarball = readdirSync(destination).find((entry) =>
    entry.endsWith('.tgz')
  )
  if (!tarball) {
    throw new Error(`npm pack produced no tarball for ${name}@${version}`)
  }

  execFileSync(
    'tar',
    ['xzf', path.join(destination, tarball), '-C', destination],
    {
      stdio: 'inherit'
    }
  )

  return path.join(destination, 'package')
}

function main() {
  const name = getArg('--package') || 'extension'
  const version = getArg('--version')

  if (!version) {
    console.error('error: --version is required')
    process.exit(1)
  }

  const workDir = mkdtempSync(path.join(tmpdir(), 'extension-artifact-'))

  try {
    console.log(`Reading the published tarball for ${name}@${version} from npm`)
    const packageDir = fetchPublishedPackage(name, version, workDir)

    const manifest = JSON.parse(
      readFileSync(path.join(packageDir, 'package.json'), 'utf8')
    )
    if (manifest.version !== version) {
      console.error(
        `error: ${name}@${version} unpacks to version ${manifest.version}`
      )
      process.exit(1)
    }

    const readArtifactFile = (relativePath) =>
      readFileSync(path.join(packageDir, relativePath), 'utf8')

    const missing = findMissingMarkers(readArtifactFile)

    if (missing.length > 0) {
      console.error(
        `\nerror: the published ${name}@${version} tarball is missing ${missing.length} required marker(s).`
      )
      for (const marker of missing) {
        console.error(
          `  ${marker.file} has no ${JSON.stringify(marker.pattern)}`
        )
        console.error(`    invariant: ${marker.invariant}`)
      }
      console.error(
        '\nA green release run is not a shipped fix. Publish a version built from a commit that carries these.'
      )
      process.exit(1)
    }

    for (const marker of REQUIRED_ARTIFACT_MARKERS) {
      console.log(
        `ok: ${marker.file} carries ${JSON.stringify(marker.pattern)} (${marker.invariant})`
      )
    }
    console.log(`\nPublished ${name}@${version} carries every required marker.`)
  } finally {
    rmSync(workDir, {recursive: true, force: true})
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main()
}
