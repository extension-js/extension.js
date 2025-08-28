import {type Template} from './types'

const ALL_TEMPLATES: Template[] = [
  {
    name: 'javascript',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'typescript',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json']
  },
  {
    name: 'react',
    uiContext: ['content'],
    uiFramework: 'react',
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tailwind.config.js', 'tsconfig.json']
  },
  {
    name: 'centralized-logger',
    uiContext: ['content'],
    uiFramework: 'react',
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tailwind.config.js', 'tsconfig.json']
  },
  {
    name: 'preact',
    uiContext: ['content'],
    uiFramework: 'preact',
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tailwind.config.js', 'tsconfig.json']
  },
  {
    name: 'vue',
    uiContext: ['content'],
    uiFramework: 'vue',
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tailwind.config.js', 'tsconfig.json']
  },
  {
    name: 'svelte',
    uiContext: ['content'],
    uiFramework: 'svelte',
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tailwind.config.js', 'tsconfig.json']
  }
]

const SUPPORTED_BROWSERS: string[] = ['chrome', 'edge', 'firefox']

export {SUPPORTED_BROWSERS, ALL_TEMPLATES}
