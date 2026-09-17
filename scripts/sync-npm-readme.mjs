#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const SOURCE_README = path.join(ROOT, 'README.md')
export const NPM_README = path.join(ROOT, 'programs', 'extension', 'README.md')

export function transformReadme(content) {
  // npm renders the page narrower, so the right-aligned logo shrinks there.
  let out = content.replace(
    /(<img alt="Logo"[^>]*width=")[\d.]+%(")/g,
    '$114.1%$2'
  )

  // npm prints its own download count above the readme.
  out = out.replace(
    /\s*\[!\[Downloads\]\[npm-downloads-image\]\]\[npm-downloads-url\]/g,
    ''
  )

  out = out
    .split('\n')
    .filter(
      (line) =>
        !/^\[npm-downloads-image\]:/i.test(line) &&
        !/^\[npm-downloads-url\]:/i.test(line)
    )
    .join('\n')

  // npm has no star count, and GitHub renders README.md untransformed, so the
  // stars badge can only be injected into the npm copy.
  out = out.replace(
    /(# Extension\.js \[!\[Version\]\[npm-version-image\]\]\[npm-version-url\])/,
    '$1 [![Stars][stars-image]][stars-url]'
  )

  out = out.replace(
    /(\[npm-version-url\]: [^\n]*\n)/,
    '$1[stars-image]: https://img.shields.io/github/stars/extension-js/extension.js?style=flat&color=0971fe\n' +
      '[stars-url]: https://github.com/extension-js/extension.js/stargazers\n'
  )

  return out
}

export function syncNpmReadme({
  source = SOURCE_README,
  target = NPM_README,
  write = true
} = {}) {
  const expected = transformReadme(fs.readFileSync(source, 'utf8'))
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null
  const stale = current !== expected

  if (stale && write) fs.writeFileSync(target, expected)

  return {stale, target}
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const check = process.argv.includes('--check')
  const {stale, target} = syncNpmReadme({write: !check})
  const relative = path.relative(ROOT, target)

  if (check && stale) {
    console.error(
      `${relative} is out of date with README.md. Run: node scripts/sync-npm-readme.mjs`
    )

    process.exit(1)
  }

  console.log(
    stale ? `Updated ${relative} from README.md` : `${relative} is up to date`
  )
}
