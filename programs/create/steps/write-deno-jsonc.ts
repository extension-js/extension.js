//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as messages from '../lib/messages'
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

// In primary mode deno.jsonc IS the project manifest: npm dependencies are
// declared as `npm:` specifiers in `imports`, `deno install` resolves them,
// `nodeModulesDir: "auto"` materializes them in a real node_modules the
// bundler can resolve from, and the Extension.js toolchain reads the imports
// for framework/CSS/TypeScript detection. In companion mode (monorepo
// templates) package.json stays the dependency manifest and deno.jsonc only
// adds Deno-native tasks.
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
  let templatePackageJson: Record<string, any> = {}
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
  /**
   * When true, deno.jsonc becomes the project's only manifest: template
   * dependencies move into `imports` and package.json is removed
   * (issue #482, deno.jsonc instead of package.json).
   */
  primary?: boolean
}

export async function writeDenoJsonc(
  projectPath: string,
  projectName: string,
  {template = 'javascript', cliVersion, primary = false}: WriteDenoJsoncOptions,
  logger: {log(...args: any[]): void; error(...args: any[]): void}
) {
  if (!isDenoRuntime()) {
    return
  }

  // Respect a Deno config the template itself ships.
  for (const existing of ['deno.jsonc', 'deno.json']) {
    if (await pathExists(path.join(projectPath, existing))) {
      return
    }
  }

  const extensionBinary = await resolveExtensionBinary()
  const tasks = getTemplateAwareScripts(template, extensionBinary)
  const imports = primary
    ? await collectTemplateImports(projectPath, cliVersion)
    : undefined

  try {
    logger.log(messages.writingDenoJsonc())
    await fs.writeFile(
      path.join(projectPath, 'deno.jsonc'),
      renderDenoJsonc(tasks, imports)
    )

    if (primary) {
      // deno.jsonc replaces package.json as the manifest.
      await fs.rm(path.join(projectPath, 'package.json'), {force: true})
    }
  } catch (error: any) {
    logger.error(messages.writingDenoJsoncError(projectName, error))
    throw error
  }
}
