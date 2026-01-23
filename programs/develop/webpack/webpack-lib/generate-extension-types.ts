// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {Dirent} from 'fs'
import * as fs from 'fs/promises'
import * as messages from './messages'

export async function generateExtensionTypes(
  manifestDir: string,
  packageJsonDir: string
) {
  const extensionEnvFile = path.join(packageJsonDir, 'extension-env.d.ts')
  // TODO(cezaraugusto): consider this
  // const extensionPathsFile = path.join(packageJsonDir, 'extension-paths.d.ts')
  const {
    dependencies,
    devDependencies,
    peerDependencies,
    optionalDependencies
  } = await readPackageJson(packageJsonDir)
  const hasDependency = (name: string) =>
    Boolean(
      dependencies[name] ||
      devDependencies[name] ||
      peerDependencies[name] ||
      optionalDependencies[name]
    )
  const usesReact = hasDependency('react') || hasDependency('@types/react')
  const usesReactDom =
    hasDependency('react-dom') || hasDependency('@types/react-dom')
  const usesSvelte = hasDependency('svelte')
  const frameworkTypeRefs = [
    usesReact ? '/// <reference types="react" />' : '',
    usesReactDom ? '/// <reference types="react-dom" />' : '',
    usesSvelte ? '/// <reference types="svelte" />' : ''
  ]
    .filter(Boolean)
    .join('\n')
  const fileContent = `\
// Required Extension.js types for TypeScript projects.
// This file is auto-generated and should not be excluded.
//
/// <reference types="webextension-polyfill" />
/// <reference types="node" />
/// <reference types="chrome" />
${frameworkTypeRefs}

declare global {
  // Align types with Extension.js runtime: we provide the browser global via
  // webextension-polyfill in Chromium, and it's natively available in Firefox.
  const browser: typeof import('webextension-polyfill')

  type ExtensionBrowser =
    | 'chrome'
    | 'edge'
    | 'firefox'
    | 'chromium-based'
    | 'gecko-based'

  type ExtensionMode = 'development' | 'production'

  interface ExtensionEnv {
    EXTENSION_BROWSER: ExtensionBrowser
    EXTENSION_MODE: ExtensionMode
    EXTENSION_PUBLIC_BROWSER: ExtensionBrowser
    EXTENSION_PUBLIC_MODE: ExtensionMode
    EXTENSION_PUBLIC_DESCRIPTION_TEXT: string
    EXTENSION_PUBLIC_LLM_API_KEY: string
    EXTENSION_AUTHOR_MODE: string
    EXTENSION_PUBLIC_AUTHOR_MODE: string
  }

  namespace NodeJS {
    interface ProcessEnv extends ExtensionEnv {
      [key: string]: string | undefined
    }
  }

  interface ImportMetaEnv extends ExtensionEnv {
    [key: string]: string | undefined
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
    readonly webpackHot?: {
      accept: (module?: string | string[], callback?: () => void) => void
      dispose: (callback: () => void) => void
    }
    url: string
  }

  interface Window {
    /**
     * @deprecated
     * @description
     * This is how Extension.js used to inject the shadow root into the window object.
     * Use the shadowRoot reference from the content script instead.
     */
    __EXTENSION_SHADOW_ROOT__: ShadowRoot
  }
}

// Asset imports (CSS modules + static images)
type CSSContentData = Readonly<Record<string, string>>
type CSSModuleData = Readonly<Record<string, string>>

declare module '*.css' {
  const content: CSSContentData
  export default content
}

declare module '*.module.css' {
  const content: CSSModuleData
  export default content
}
declare module '*.module.scss' {
  const content: CSSModuleData
  export default content
}
declare module '*.module.sass' {
  const content: CSSModuleData
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}
declare module '*.jpg' {
  const content: string
  export default content
}
declare module '*.jpeg' {
  const content: string
  export default content
}
declare module '*.gif' {
  const content: string
  export default content
}
declare module '*.webp' {
  const content: string
  export default content
}
declare module '*.avif' {
  const content: string
  export default content
}
declare module '*.ico' {
  const content: string
  export default content
}
declare module '*.bmp' {
  const content: string
  export default content
}
declare module '*.svg' {
  // Use any to avoid conflicts with SVGR or other SVG loaders.
  const content: any
  export default content
}

export {}
`

  try {
    // Check if the file exists
    await fs.access(extensionEnvFile)

    // Read the file content
    const existingContent = await fs.readFile(extensionEnvFile, 'utf8')

    // Check if the file contains the "develop/dist/types" string
    if (existingContent.includes('develop/dist/types')) {
      // Rewrite previous path for versions < 2.0.0. See #162
      await fs.writeFile(extensionEnvFile, fileContent)
    }

    // Always rewrite the path to ensure it uses the correct published package path
    await fs.writeFile(extensionEnvFile, fileContent)
  } catch (err) {
    // File does not exist, continue to write it
    const manifest = require(path.join(manifestDir, 'manifest.json'))
    console.log(messages.writingTypeDefinitions(manifest))
    try {
      await fs.writeFile(extensionEnvFile, fileContent)
    } catch (writeErr) {
      console.log(messages.writingTypeDefinitionsError(writeErr))
    }
  }

  // TODO(cezaraugusto): consider this
  // Generate extension-paths.d.ts with unions for editor intellisense
  // try {
  //   const root = packageJsonDir
  //   async function listFiles(rel: string): Promise<string[]> {
  //     const dir = path.join(root, rel)
  //     const out: string[] = []
  //
  //     async function walk(d: string, base: string) {
  //       let entries: Dirent[] = []
  //       try {
  //         entries = await fs.readdir(d, {withFileTypes: true})
  //       } catch {
  //         return
  //       }
  //
  //       for (const e of entries) {
  //         if (e.name.startsWith('.')) continue
  //
  //         const abs = path.join(d, e.name)
  //         const r = path.posix.join(base, e.name)
  //
  //         if (e.isDirectory()) {
  //           await walk(abs, r)
  //         } else {
  //           out.push(r)
  //         }
  //       }
  //     }
  //
  //     await walk(dir, '')
  //
  //     return out.map((p) => p.replace(/\\\\/g, '/'))
  //   }
  //
  //   const [publicFiles, pageFiles, scriptFiles] = await Promise.all([
  //     listFiles('public').catch(() => []),
  //     listFiles('pages').catch(() => []),
  //     listFiles('scripts').catch(() => [])
  //   ])
  //
  //   function toLiterals(values: string[]): string {
  //     if (!values || values.length === 0) return 'never'
  //     return values.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(' | ')
  //   }
  //
  //   // Public paths: expose three common forms for convenience
  //   const publicRel = publicFiles
  //   const publicWithPrefix = publicRel.map((p) => `public/${p}`)
  //   const publicWithSlashPrefix = publicRel.map((p) => `/public/${p}`)
  //   const publicRootSlash = publicRel.map((p) => `/${p}`)
  //
  //   const pages = pageFiles.map((p) => `pages/${p}`)
  //   const scripts = scriptFiles.map((p) => `scripts/${p}`)
  //
  //   const content = `
  // // Auto-generated by Extension.js. Literal unions for editor Intellisense.
  // // Do not edit manually.
  // declare namespace ExtensionPaths {
  //   type KnownPublic = ${toLiterals(publicWithPrefix)} | ${toLiterals(publicWithSlashPrefix)} | ${toLiterals(publicRootSlash)}
  //   type KnownPages = ${toLiterals(pages)}
  //   type KnownScripts = ${toLiterals(scripts)}
  //   type KnownPath = KnownPublic | KnownPages | KnownScripts
  // }
  //
  // // Helper overload for IDEs: getURL only accepts known paths
  // declare function __extensionjs_getURL<Path extends ExtensionPaths.KnownPath>(p: Path): string
  // export {}
  // `
  //
  //   await fs.writeFile(extensionPathsFile, content)
  // } catch (err) {
  //   // best effort; do not fail dev if generation fails
  // }
}

async function readPackageJson(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')
  try {
    const content = await fs.readFile(packageJsonPath, 'utf8')
    const parsed = JSON.parse(content) || {}
    return {
      dependencies: parsed.dependencies || {},
      devDependencies: parsed.devDependencies || {},
      peerDependencies: parsed.peerDependencies || {},
      optionalDependencies: parsed.optionalDependencies || {}
    }
  } catch {
    return {
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
      optionalDependencies: {}
    }
  }
}
