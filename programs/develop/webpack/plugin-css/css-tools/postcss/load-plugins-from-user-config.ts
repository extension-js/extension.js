import * as path from 'path'
import {createRequire} from 'module'

export async function loadPluginsFromUserConfig(
  projectPath: string,
  userPostCssConfig: string | undefined,
  mode: string | undefined
): Promise<Array<any> | undefined> {
  if (!userPostCssConfig) return undefined

  try {
    const req = createRequire(path.join(projectPath, 'package.json'))

    // Configs may export an object or a function(ctx) returning an object
    let loaded: any

    try {
      loaded = req(userPostCssConfig)
    } catch (err: any) {
      if (
        err?.code === 'ERR_REQUIRE_ESM' ||
        userPostCssConfig.endsWith('.mjs')
      ) {
        // Fallback to dynamic import for ESM configs
        const mod = await import(userPostCssConfig)
        loaded = (mod && (mod as any).default) || mod
      } else {
        throw err
      }
    }

    const config =
      typeof loaded === 'function'
        ? loaded({
            env: process.env.NODE_ENV || mode || 'development',
            mode: mode || 'development'
          })
        : loaded

    let plugins: any = config?.plugins

    if (!plugins) return []

    // Normalize supported PostCSS plugin formats:
    // - Array of functions/strings/tuples
    // - Object map { 'plugin-name': options | true | false }
    const normalized: Array<any> = []
    if (Array.isArray(plugins)) {
      for (const entry of plugins) {
        if (typeof entry === 'function') {
          normalized.push(entry)
        } else if (typeof entry === 'string') {
          const plugin = req(entry)
          normalized.push(
            plugin && (plugin as any).default ? (plugin as any).default : plugin
          )
        } else if (Array.isArray(entry)) {
          const [pluginRef, pluginOpts] = entry
          if (typeof pluginRef === 'string') {
            const plugin = req(pluginRef)
            const pluginFn =
              plugin && (plugin as any).default
                ? (plugin as any).default
                : plugin
            normalized.push([pluginFn, pluginOpts])
          } else {
            normalized.push([pluginRef, pluginOpts])
          }
        } else if (entry && typeof entry === 'object') {
          // Either a plugin object { postcss: fn } or a map of plugin names
          const maybePlugin = (entry as any).postcss
          if (maybePlugin) {
            normalized.push(maybePlugin)
          } else {
            for (const [name, pluginOpts] of Object.entries(entry as any)) {
              if (pluginOpts === false) continue

              const plugin = req(name)
              const pluginFn =
                plugin && (plugin as any).default
                  ? (plugin as any).default
                  : plugin

              if (pluginOpts === true || pluginOpts === undefined) {
                normalized.push(pluginFn)
              } else {
                normalized.push([pluginFn, pluginOpts])
              }
            }
          }
        }
      }
    } else if (plugins && typeof plugins === 'object') {
      for (const [name, pluginOpts] of Object.entries(plugins)) {
        if (pluginOpts === false) continue
        const plugin = req(name)
        const pluginFn =
          plugin && (plugin as any).default ? (plugin as any).default : plugin
        if (pluginOpts === true || pluginOpts === undefined) {
          normalized.push(pluginFn)
        } else {
          normalized.push([pluginFn, pluginOpts])
        }
      }
    }

    return normalized
  } catch {
    return undefined
  }
}
