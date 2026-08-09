//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {parseJsoncSafe} from '../lib/deno-manifest'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'
import {isDenoRuntime} from '../lib/package-manager'
import {
  getTemplateAwareScripts,
  resolveExtensionBinary,
  resolveExtensionDevDependencyVersion
} from './write-package-json'

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function renderJsoncEntries(entries: Record<string, string>): string {
  const pairs = Object.entries(entries)
  return pairs
    .map(([name, value], index) => {
      const separator = index < pairs.length - 1 ? ',' : ''
      return `    ${JSON.stringify(name)}: ${JSON.stringify(value)}${separator}`
    })
    .join('\n')
}

// In primary mode deno.jsonc IS the project manifest (npm: specifiers in
// imports, nodeModulesDir auto); in companion mode package.json stays.
function renderDenoJsonc(
  tasks: Record<string, string>,
  imports?: Record<string, string>
): string {
  const importsSection = imports
    ? `  // npm dependencies, declared as npm: specifiers. \`deno install\`\n` +
      `  // resolves them, and the Extension.js toolchain reads them for\n` +
      `  // framework, CSS, and TypeScript detection.\n` +
      `  "imports": {\n` +
      `${renderJsoncEntries(imports)}\n` +
      `  },\n` +
      `\n`
    : `  // Dependencies stay declared in package.json, \`deno install\` resolves\n` +
      `  // them from there, and the Extension.js toolchain reads them for\n` +
      `  // framework detection. Keep Deno-native settings and tasks here.\n` +
      `\n`

  return (
    `{\n` +
    `  // Deno configuration for this Extension.js project.\n` +
    `\n` +
    importsSection +
    `  // Materialize npm dependencies in a real node_modules directory;\n` +
    `  // the bundler resolves project dependencies from it at dev/build time.\n` +
    `  "nodeModulesDir": "auto",\n` +
    `\n` +
    `  // \`deno task <name>\` also finds binaries in node_modules/.bin,\n` +
    `  // so these run the locally installed Extension.js CLI.\n` +
    `  "tasks": {\n` +
    `${renderJsoncEntries(tasks)}\n` +
    `  }\n` +
    `}\n`
  )
}

function toNpmSpecifier(name: string, version: string): string {
  // Template dependencies occasionally point at other registries already.
  if (version.startsWith('npm:') || version.startsWith('jsr:')) return version
  return `npm:${name}@${version}`
}

async function collectTemplateImports(
  projectPath: string,
  cliVersion?: string
): Promise<Record<string, string>> {
  let templatePackageJson: Record<string, unknown> = {}
  try {
    const raw = await fs.readFile(path.join(projectPath, 'package.json'))
    templatePackageJson = JSON.parse(raw.toString())
  } catch {
    // Web-only remote templates may not include package.json.
  }

  const declared: Record<string, string> = {
    ...(templatePackageJson.dependencies || {}),
    ...(templatePackageJson.devDependencies || {})
  }
  delete declared.extension

  const imports: Record<string, string> = {}
  for (const [name, version] of Object.entries(declared)) {
    if (typeof version !== 'string') continue
    imports[name] = toNpmSpecifier(name, version)
  }

  // Mirrors overridePackageJson: the local CLI in repo author mode, an exact
  // prerelease pin for canaries, a caret range otherwise.
  const extensionVersion =
    process.env.EXTENSION_ENV === 'development'
      ? '*'
      : resolveExtensionDevDependencyVersion(cliVersion)
  imports.extension = `npm:extension@${extensionVersion}`

  return imports
}

interface WriteDenoJsoncOptions {
  template?: string
  cliVersion?: string
  // When true, deno.jsonc becomes the project's only manifest: template deps
  // move into `imports` and package.json is removed (issue #482).
  primary?: boolean
}

export async function writeDenoJsonc(
  projectPath: string,
  {template = 'javascript', cliVersion, primary = false}: WriteDenoJsoncOptions,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
) {
  if (!isDenoRuntime()) {
    return
  }

  // Respect a Deno config the template itself ships. Deno's own discovery
  // prefers deno.json over deno.jsonc, so target the file Deno will read.
  let existingConfig: string | undefined
  for (const candidate of ['deno.json', 'deno.jsonc']) {
    if (await pathExists(path.join(projectPath, candidate))) {
      existingConfig = candidate
      break
    }
  }

  if (existingConfig && !primary) {
    return
  }

  const extensionBinary = await resolveExtensionBinary()
  const tasks = getTemplateAwareScripts(template, extensionBinary)
  const imports = primary
    ? await collectTemplateImports(projectPath, cliVersion)
    : undefined

  try {
    if (isDebug()) logger.log(messages.writingDenoJsonc())
    if (existingConfig) {
      // Primary mode with a template-shipped config: the config still has to
      // become the only manifest, with the `extension` import folded in and
      // package.json retired, or `deno task dev` never finds the CLI (#482).
      const configPath = path.join(projectPath, existingConfig)
      const config = parseJsoncSafe(await fs.readFile(configPath, 'utf8'))
      // Template imports stay authoritative for everything they pin, except
      // `extension`: that always matches the CLI doing the scaffold, same as
      // overridePackageJson rewrites devDependencies.extension. An old
      // template pin would otherwise install a CLI the rest of the scaffold
      // no longer speaks to.
      config.imports = {...(imports || {}), ...(config.imports || {})}
      if (imports?.extension) {
        config.imports.extension = imports.extension
      }
      // Always materialize a real node_modules: scaffold tasks invoke the
      // Extension.js CLI from node_modules/.bin. A template that sets
      // nodeModulesDir to "none"/"manual"/false would ship a config whose
      // tasks cannot resolve their tooling.
      config.nodeModulesDir = 'auto'
      // Scaffold defaults first, template tasks on top, same order as
      // overridePackageJson scripts. A template that only adds fmt keeps
      // dev/build/…; a template that already defines dev keeps its version.
      config.tasks = {
        ...tasks,
        ...((config.tasks as Record<string, string> | undefined) || {})
      }
      await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
    } else {
      await fs.writeFile(
        path.join(projectPath, 'deno.jsonc'),
        renderDenoJsonc(tasks, imports)
      )
    }

    if (primary) {
      // The Deno config replaces package.json as the manifest.
      await fs.rm(path.join(projectPath, 'package.json'), {force: true})
    }
  } catch (error) {
    logger.error(messages.writingDenoJsoncError(error))
    throw error
  }
}
