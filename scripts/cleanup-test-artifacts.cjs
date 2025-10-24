#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

// Lazy require micromatch if available, otherwise fall back to simple contains
let micromatch
try {
  micromatch = require('micromatch')
} catch (e) {
  micromatch = null
  void e
}

const patterns = [
  // Vitest tmp workspaces
  'programs/develop/**/__spec__/.tmp-*',
  'programs/develop/.tmp-*',
  // Playwright example build outputs
  'extensions/**/dist',
  'templates/**/dist'
]

function listAll(root) {
  const out = []
  function walk(dir) {
    let entries
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        out.push(abs + path.sep)
        walk(abs)
      } else {
        out.push(abs)
      }
    }
  }
  walk(root)
  return out
}

function matchAll(paths, globs) {
  if (micromatch) return micromatch(paths, globs, {dot: true})
  // naive fallback: substring includes
  return paths.filter((p) => globs.some((g) => p.includes(g.replace('**/', ''))))
}

function rmSafe(target) {
  try {
    const stat = fs.statSync(target, {throwIfNoEntry: false})
    if (!stat) return
    // guardrails: avoid nuking repo root dist or node_modules
    const lowered = target.toLowerCase()
    if (lowered.endsWith(`${path.sep}dist`) && target.split(path.sep).length <= 3)
      return
    if (lowered.includes(`${path.sep}node_modules${path.sep}`)) return
    fs.rmSync(target, {recursive: true, force: true})
    console.log('Removed', target)
  } catch (e) {
    // ignore errors during removal
    void e
  }
}

const all = listAll(process.cwd())
const matches = matchAll(all, patterns)
for (const m of matches) {
  const dir = m.endsWith(path.sep) ? m : path.dirname(m)
  if (dir.includes('.tmp-') || dir.endsWith(`${path.sep}dist`)) {
    rmSafe(dir)
  }
}


