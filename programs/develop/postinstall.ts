// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {ensureProjectReady} from './webpack/webpack-lib/dependency-manager'

function isNpxExec(): boolean {
  const argv = process.env.npm_config_argv
  if (argv) {
    try {
      const parsed = JSON.parse(argv) as {
        original?: string[]
        cooked?: string[]
      }
      const original = parsed.original || parsed.cooked || []
      if (
        original.includes('exec') ||
        original.includes('npx') ||
        original.includes('dlx') ||
        original.includes('bunx')
      ) {
        return true
      }
    } catch {
      // ignore
    }
  }
  const userAgent = process.env.npm_config_user_agent || ''
  return userAgent.includes('npx')
}

async function runPostinstall() {
  if (process.env.EXTENSION_DISABLE_AUTO_INSTALL === 'true') return
  if (isNpxExec()) return

  const initCwd = process.env.INIT_CWD || process.cwd()
  const packageJsonPath = path.join(initCwd, 'package.json')

  if (!fs.existsSync(packageJsonPath)) return

  try {
    const projectStructure = {
      manifestPath: path.join(initCwd, 'manifest.json'),
      packageJsonPath
    }

    await ensureProjectReady(projectStructure, 'development', {
      installUserDeps: true,
      installBuildDeps: true,
      installOptionalDeps: true,
      backgroundOptionalDeps: false,
      exitOnInstall: false,
      showRunAgainMessage: false
    })
  } catch {
    // Best-effort: postinstall should never block user installs.
  }
}

void runPostinstall()
