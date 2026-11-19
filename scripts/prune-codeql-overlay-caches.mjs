#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

// The CodeQL action saves one overlay base per run of main, keyed by commit,
// run and attempt, and restores only the newest. The rest only fill the cache.
const OVERLAY_PREFIX = 'codeql-overlay-base-database-'
const RUN_SUFFIX = /-[0-9a-f]{40}-\d+-\d+$/

export function staleOverlayCaches(caches) {
  const newest = new Map()
  const stale = []

  for (const cache of caches) {
    if (!cache.key.startsWith(OVERLAY_PREFIX)) continue

    const group = cache.key.replace(RUN_SUFFIX, '')
    const kept = newest.get(group)

    if (!kept) {
      newest.set(group, cache)
    } else if (Date.parse(cache.createdAt) > Date.parse(kept.createdAt)) {
      stale.push(kept)
      newest.set(group, cache)
    } else {
      stale.push(cache)
    }
  }

  return stale
}

function gh(args) {
  const result = spawnSync('gh', args, {encoding: 'utf8'})

  if (result.error) throw result.error

  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }

  return result.stdout
}

export function pruneOverlayCaches(repo) {
  const listing = gh([
    'cache',
    'list',
    '--repo',
    repo,
    '--ref',
    'refs/heads/main',
    '--key',
    OVERLAY_PREFIX,
    '--limit',
    '100',
    '--json',
    'id,key,createdAt'
  ])
  const stale = staleOverlayCaches(JSON.parse(listing))

  for (const cache of stale) {
    gh(['cache', 'delete', String(cache.id), '--repo', repo])
    console.log(`Deleted ${cache.key}`)
  }

  console.log(`Removed ${stale.length} older CodeQL overlay bases`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''

if (invokedPath === fileURLToPath(import.meta.url)) {
  const repo = process.env.GITHUB_REPOSITORY

  if (!repo) {
    console.error('GITHUB_REPOSITORY is not set')
    process.exit(1)
  }

  pruneOverlayCaches(repo)
}
