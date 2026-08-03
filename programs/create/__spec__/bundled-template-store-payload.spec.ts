import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates')

function bundledTemplates(): string[] {
  if (!fs.existsSync(TEMPLATES_DIR)) return []
  return fs
    .readdirSync(TEMPLATES_DIR, {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function walk(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full, base))
    } else {
      out.push(path.relative(base, full).split(path.sep).join('/'))
    }
  }
  return out
}

describe('bundled templates keep documentation art out of the store payload', () => {
  it('there is at least one bundled template to check', () => {
    expect(bundledTemplates().length).toBeGreaterThan(0)
  })

  it.each(bundledTemplates())(
    '%s ships no screenshot under public/, which the build copies verbatim',
    (template) => {
      const publicDir = path.join(TEMPLATES_DIR, template, 'public')
      const offenders = walk(publicDir).filter((file) =>
        /screenshot.*\.(png|jpe?g|webp|gif)$/i.test(file)
      )
      expect(offenders).toEqual([])
    }
  )

  it.each(bundledTemplates())(
    '%s keeps every public/ asset small enough to belong in a shipped extension',
    (template) => {
      const publicDir = path.join(TEMPLATES_DIR, template, 'public')
      const heavy = walk(publicDir)
        .map((file) => ({
          file,
          bytes: fs.statSync(path.join(publicDir, file)).size
        }))
        .filter((entry) => entry.bytes > 100_000)
        .map((entry) => `${entry.file} (${entry.bytes} bytes)`)
      expect(heavy).toEqual([])
    }
  )

  it.each(bundledTemplates())(
    '%s README points at a screenshot that exists where it points',
    (template) => {
      const readme = path.join(TEMPLATES_DIR, template, 'README.md')
      if (!fs.existsSync(readme)) return
      const embeds = [
        ...fs.readFileSync(readme, 'utf8').matchAll(/!\[[^\]]*\]\((\.\/[^)]+)\)/g)
      ].map((match) => match[1])
      const missing = embeds.filter(
        (href) => !fs.existsSync(path.join(TEMPLATES_DIR, template, href))
      )
      expect(missing).toEqual([])
    }
  )
})
