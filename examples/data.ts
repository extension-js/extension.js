import {type Template} from './types'

const DEFAULT_TEMPLATE: Template = {
  name: 'init',
  uiContext: undefined,
  uiFramework: undefined,
  css: 'css',
  hasBackground: false,
  hasEnv: false,
  configFiles: undefined
}

const JS_TEMPLATES: Template[] = [
  {
    name: 'action',
    uiContext: ['action'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'content',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'content-esm',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  // {
  //   name: 'content-css-modules',
  //   uiContext: ['content'],
  //   uiFramework: undefined,
  //   css: 'css',
  //   hasBackground: false,
  //   hasEnv: false,
  //   configFiles: undefined
  // },
  {
    name: 'content-less',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'less',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  // {
  //   name: 'content-less-modules',
  //   uiContext: ['content'],
  //   uiFramework: undefined,
  //   css: 'less',
  //   hasBackground: false,
  //   hasEnv: false,
  //   configFiles: undefined
  // },
  {
    name: 'content-main-world',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'content-sass',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'sass',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  // {
  //   name: 'content-sass-modules',
  //   uiContext: ['content'],
  //   uiFramework: undefined,
  //   css: 'sass',
  //   hasBackground: false,
  //   hasEnv: false,
  //   configFiles: undefined
  // },
  {
    name: 'declarative_net_request',
    uiContext: undefined,
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'action-locales',
    uiContext: ['action'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'new',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'new-esm',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'new-less',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'less',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'new-sass',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'sass',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'sidebar',
    uiContext: ['sidebar'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'special-folders-pages',
    uiContext: undefined,
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'special-folders-scripts',
    uiContext: undefined,
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'storage',
    uiContext: undefined,
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  }
]

const WASM_TEMPLATES: Template[] = []

const TS_TEMPLATES: Template[] = [
  {
    name: 'content-typescript',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json']
  },
  {
    name: 'content-env',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json']
  },
  {
    name: 'new-typescript',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json']
  },
  {
    name: 'new-env',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json']
  }
]

const CUSTOM_TEMPLATES: Template[] = [
  {
    name: 'action-chatgpt',
    uiContext: ['action'],
    uiFramework: 'react',
    css: 'css',
    hasBackground: false,
    hasEnv: true,
    configFiles: ['postcss.config.js', 'tsconfig.json']
  },
  {
    name: 'new-crypto',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json', 'extension.config.js']
  },
  {
    name: 'new-node-apis',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json', 'extension.config.js']
  },
  {
    name: 'content-react-svgr',
    uiContext: ['content'],
    uiFramework: 'react',
    css: 'css',
    hasBackground: true,
    hasEnv: false,
    configFiles: ['extension.config.js', 'tsconfig.json', 'postcss.config.js']
  },
  {
    name: 'new-react-router',
    uiContext: ['newTab'],
    uiFramework: 'react',
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json']
  },
  {
    name: 'sidebar-shadcn',
    uiContext: ['sidebar'],
    uiFramework: 'react',
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tsconfig.json']
  }
]

const FRAMEWORK_TEMPLATES: Template[] = [
  // {
  //   name: 'new-react',
  //   uiContext: ['newTab'],
  //   uiFramework: 'react',
  //   css: 'css',
  //   hasBackground: false,
  //   hasEnv: false,
  //   configFiles: ['tsconfig.json']
  // },
  // {
  //   name: 'content-react',
  //   uiContext: ['content'],
  //   uiFramework: 'react',
  //   css: 'css',
  //   hasBackground: false,
  //   hasEnv: false,
  //   configFiles: ['postcss.config.js', 'tsconfig.json']
  // },
  // {
  //   name: 'new-preact',
  //   uiContext: ['newTab'],
  //   uiFramework: 'preact',
  //   css: 'css',
  //   hasBackground: false,
  //   hasEnv: false,
  //   configFiles: ['tsconfig.json']
  // },
  // {
  //   name: 'content-preact',
  //   uiContext: ['content'],
  //   uiFramework: 'preact',
  //   css: 'css',
  //   hasBackground: false,
  //   hasEnv: false,
  //   configFiles: ['postcss.config.js', 'tsconfig.json']
  // },
  // {
  //   name: 'content-extension-config',
  //   uiContext: ['content'],
  //   uiFramework: 'react',
  //   css: 'css',
  //   hasBackground: true,
  //   hasEnv: false,
  //   configFiles: ['extension.config.js', 'tsconfig.json', 'postcss.config.js']
  // },
  // {
  //   name: 'new-vue',
  //   uiContext: ['newTab'],
  //   uiFramework: 'vue',
  //   css: 'css',
  //   hasBackground: false,
  //   hasEnv: false,
  //   configFiles: ['tsconfig.json']
  // },
  // {
  //   name: 'content-vue',
  //   uiContext: ['content'],
  //   uiFramework: 'vue',
  //   css: 'css',
  //   hasBackground: false,
  //   hasEnv: false,
  //   configFiles: ['postcss.config.js', 'tsconfig.json']
  // },
  {
    name: 'new-svelte',
    uiContext: ['newTab'],
    uiFramework: 'svelte',
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json']
  }
]

const CONFIG_TEMPLATES: Template[] = [
  {
    name: 'new-config-eslint',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json', 'eslint.config.mjs']
  },
  {
    name: 'new-config-lint',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: [
      'tsconfig.json',
      '.stylelintrc.json',
      'eslint.config.mjs',
      '.prettierrc',
      '.stylelintrc.json'
    ]
  },
  {
    name: 'new-config-prettier',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json', '.prettierrc']
  },
  {
    name: 'new-config-stylelint',
    uiContext: ['newTab'],
    uiFramework: undefined,
    css: 'sass',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['.stylelintrc.json']
  },
  {
    name: 'content-tailwind',
    uiContext: ['content'],
    uiFramework: undefined,
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js']
  },
  {
    name: 'new-tailwind',
    uiContext: ['newTab'],
    uiFramework: 'react',
    css: 'css',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tsconfig.json']
  }
]

const ALL_TEMPLATES: Template[] = [
  DEFAULT_TEMPLATE,
  ...JS_TEMPLATES,
  ...WASM_TEMPLATES,
  ...TS_TEMPLATES,
  ...CUSTOM_TEMPLATES,
  ...FRAMEWORK_TEMPLATES,
  ...CONFIG_TEMPLATES
]

const ALL_TEMPLATES_BUT_DEFAULT = ALL_TEMPLATES.filter(
  (template) => template.name !== 'init'
)

const SUPPORTED_BROWSERS: string[] = ['chrome', 'edge', 'firefox']

export {
  SUPPORTED_BROWSERS,
  DEFAULT_TEMPLATE,
  JS_TEMPLATES,
  WASM_TEMPLATES,
  TS_TEMPLATES,
  CUSTOM_TEMPLATES,
  FRAMEWORK_TEMPLATES,
  CONFIG_TEMPLATES,
  ALL_TEMPLATES,
  ALL_TEMPLATES_BUT_DEFAULT
}
