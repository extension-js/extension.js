//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// biome-ignore lint/style/useImportType: the published module.d.ts repeats this import as written
import {type ScaffoldPackageManager} from './lib/package-manager'
import {runCreate} from './run-create'
// biome-ignore lint/style/useImportType: the published module.d.ts repeats this import as written
import {type TemplateProvenance} from './steps/import-external-template'

// Re-exported so the CLI's template listing and the resolver that actually
// downloads a template read the SAME table. Two copies would drift, and the
// drift would show up as a name the help text offers and create cannot fetch.
export {
  resolveTemplateAlias,
  TEMPLATE_ALIASES
} from './steps/import-external-template'

export interface CreateLogger {
  log: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface CreateOptions {
  template?: string
  install?: boolean
  cliVersion?: string
  logger?: CreateLogger
}

export interface CreateResult {
  projectPath: string
  projectName: string
  template: string
  depsInstalled: boolean
  // Whole seconds the dependency install took, absent when none ran.
  installSeconds?: number
  // The package manager the scaffold was created with; programmatic hosts read
  // this to render correct next steps instead of re-deriving from a lockfile.
  packageManager: ScaffoldPackageManager
  // Which template corpus the scaffold was cut from (ref/source), also stamped
  // into the project as `.extension-create.json` for reproducibility.
  templateProvenance: TemplateProvenance
}

export async function extensionCreate(
  projectNameInput: string | undefined,
  {cliVersion, template, install = false, logger = console}: CreateOptions
): Promise<CreateResult> {
  return runCreate(projectNameInput, {cliVersion, template, install, logger})
}
