import * as path from 'path'
import * as fs from 'fs'
import {defineConfig} from '@rslib/core'
import type {RslibConfig} from '@rslib/core'

function copyReadmePlugin() {
  return {
    name: 'copy-readme',
    setup(api: any) {
      api.onAfterBuild(() => {
        const sourceReadme = path.join(__dirname, '../../README.md')
        const targetReadme = path.join(__dirname, 'README.md')
        const sourceContent = fs.readFileSync(sourceReadme, 'utf8')
        copyIfDifferentContent(sourceContent, targetReadme)
      })
    }
  }
}

function copyIfDifferentContent(sourceContent: string, target: string): void {
  if (fs.existsSync(target)) {
    const targetContent = fs.readFileSync(target, 'utf8')
    if (sourceContent !== targetContent) {
      fs.writeFileSync(target, sourceContent)
      console.log(`[Extension.js setup] File README.md copied to ${target}`)
    } else {
      console.log(
        `[Extension.js setup] File README.md haven't changed. Skipping copy...`
      )
    }
  } else {
    fs.writeFileSync(target, sourceContent)
    console.log(`[Extension.js setup] File README.md copied to ${target}`)
  }
}

export default defineConfig({
  source: {
    entry: {
      cli: path.resolve(__dirname, './cli.ts')
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      dts: true
    }
  ],
  plugins: [copyReadmePlugin()]
} satisfies RslibConfig)
