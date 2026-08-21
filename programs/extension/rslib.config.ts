//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import type {RslibConfig} from '@rslib/core'
import {defineConfig} from '@rslib/core'
import colors from 'pintor'

const require = createRequire(import.meta.url)
const shouldGenerateDts = (() => {
  try {
    require('@ast-grep/napi')
    return true
  } catch (_error) {
    // If the native binding cannot load, skip d.ts generation and keep build working.
    // eslint-disable-next-line no-console
    console.warn(
      '[Extension.js] Skipping d.ts generation: @ast-grep/napi failed to load.'
    )
    return false
  }
})()

function copyReadmePlugin() {
  return {
    name: 'copy-readme',
    setup(api: {onAfterBuild: (cb: () => void) => void}) {
      api.onAfterBuild(() => {
        const sourceReadme = path.join(__dirname, '../../README.md')
        const targetReadme = path.join(__dirname, 'README.md')
        const sourceContent = fs.readFileSync(sourceReadme, 'utf8')
        const transformed = transformReadme(sourceContent)
        copyIfDifferentContent(transformed, targetReadme)
      })
    }
  }
}

function copyIfDifferentContent(sourceContent: string, target: string): void {
  if (fs.existsSync(target)) {
    const targetContent = fs.readFileSync(target, 'utf8')
    if (sourceContent !== targetContent) {
      fs.writeFileSync(target, sourceContent)
      console.log(
        `${colors.gray('⏵⏵⏵ system')} [Extension.js setup] File README.md copied to ${target}`
      )
    } else {
      console.log(
        `${colors.gray('⏵⏵⏵ system')} [Extension.js setup] File README.md haven't changed. Skipping copy...`
      )
    }
  } else {
    fs.writeFileSync(target, sourceContent)
    console.log(
      `${colors.gray('⏵⏵⏵ system')} [Extension.js setup] File README.md copied to ${target}`
    )
  }
}

function transformReadme(content: string): string {
  // Shrink the right-aligned logo for npm's narrower layout; match the Logo tag,
  // not the exact width, so GitHub-side size tweaks can't break the rewrite.
  let out = content.replace(
    /(<img alt="Logo"[^>]*width=")[\d.]+%(")/g,
    '$114.1%$2'
  )

  // npm prints its own download count above the readme, so the badge is noise
  // there. The reference is `npm-downloads-image`, not `downloads-image`: this
  // matched nothing for as long as it has existed, and npm shipped the badge
  // the transform was written to remove.
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

  // npm has no star count of its own, so the badge earns its place here. It is
  // injected rather than stripped, which is the opposite of Downloads above,
  // because GitHub renders README.md straight from the repository: there is no
  // transform on that side to remove it, so the source file cannot carry it.
  out = out.replace(
    /(# Extension\.js \[!\[Version\]\[npm-version-image\]\]\[npm-version-url\])/,
    '$1 [![Stars][stars-image]][stars-url]'
  )
  // The reference definitions travel with it, for the same reason.
  out = out.replace(
    /(\[npm-version-url\]: [^\n]*\n)/,
    '$1[stars-image]: https://img.shields.io/github/stars/extension-js/extension.js?style=flat&color=0971fe\n' +
      '[stars-url]: https://github.com/extension-js/extension.js/stargazers\n'
  )

  return out
}

export default defineConfig({
  source: {
    entry: {
      cli: path.resolve(__dirname, './index.ts'),
      browsers: path.resolve(__dirname, './browsers/index.ts')
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      dts: shouldGenerateDts
    }
  ],
  plugins: [copyReadmePlugin()]
} satisfies RslibConfig)
