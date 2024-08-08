type UIContext = 'sidebar' | 'newTab' | 'content' | 'popup' | 'devTools'
type ConfigFiles =
  | 'postcss.config.js'
  | 'tailwind.config.js'
  | 'tsconfig.json'
  | 'babel.config.js'
  | 'stylelint.config.js'

interface Template {
  name: string
  uiContext: UIContext[] | undefined
  uiFramework: 'react' | 'preact' | 'vue' | undefined
  hasBackground: boolean
  hasEnv: boolean
  configFiles: ConfigFiles[] | undefined
}

const DEFAULT_TEMPLATE: Template = {
  name: 'init',
  uiContext: undefined,
  uiFramework: undefined,
  hasBackground: false,
  hasEnv: false,
  configFiles: undefined
}

const JS_TEMPLATES: Template[] = [
  {
    name: 'new',
    uiContext: ['newTab'],
    uiFramework: undefined,
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'content',
    uiContext: ['content'],
    uiFramework: undefined,
    hasBackground: true,
    hasEnv: false,
    configFiles: undefined
  }
]

// const WASM_TEMPLATES: Template[]: string[] = []

const TS_TEMPLATES: Template[] = [
  {
    name: 'typescript',
    uiContext: ['newTab'],
    uiFramework: undefined,
    hasBackground: false,
    hasEnv: false,
    configFiles: ['tsconfig.json']
  }
]

const CUSTOM_TEMPLATES: Template[] = [
  {
    name: 'chatgpt',
    uiContext: ['sidebar'],
    uiFramework: 'react',
    hasBackground: false,
    hasEnv: true,

    configFiles: ['postcss.config.js', 'tailwind.config.js']
  }
]

const FRAMEWORK_TEMPLATES: Template[] = [
  {
    name: 'react',
    uiContext: ['newTab'],
    uiFramework: 'react',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'react-typescript',
    uiContext: ['content'],
    uiFramework: 'react',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tailwind.config.js', 'tsconfig.json']
  },
  {
    name: 'preact',
    uiContext: ['newTab'],
    uiFramework: 'preact',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'preact-typescript',
    uiContext: ['content'],
    uiFramework: 'preact',
    hasBackground: false,
    hasEnv: false,

    configFiles: ['postcss.config.js', 'tailwind.config.js', 'tsconfig.json']
  },
  {
    name: 'vue',
    uiContext: ['newTab'],
    uiFramework: 'vue',
    hasBackground: false,
    hasEnv: false,
    configFiles: undefined
  },
  {
    name: 'vue-typescript',
    uiContext: ['content'],
    uiFramework: 'vue',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tailwind.config.js', 'tsconfig.json']
  }
]

const TAILWIND_TEMPLATES: Template[] = [
  {
    name: 'tailwind',
    uiContext: ['newTab'],
    uiFramework: 'react',
    hasBackground: false,
    hasEnv: false,
    configFiles: ['postcss.config.js', 'tailwind.config.js']
  }
]

const ALL_TEMPLATES: Template[] = [
  DEFAULT_TEMPLATE,
  ...JS_TEMPLATES,
  // ...WASM_TEMPLATES,
  ...TS_TEMPLATES,
  ...CUSTOM_TEMPLATES,
  ...FRAMEWORK_TEMPLATES,
  ...TAILWIND_TEMPLATES
]

const ALL_TEMPLATES_BUT_DEFAULT = ALL_TEMPLATES.filter(
  (template) => template.name !== 'init'
)

const BROWSERS = ['chrome', 'edge', 'firefox']

export {
  BROWSERS,
  DEFAULT_TEMPLATE,
  JS_TEMPLATES,
  // WASM_TEMPLATES,
  TS_TEMPLATES,
  CUSTOM_TEMPLATES,
  FRAMEWORK_TEMPLATES,
  TAILWIND_TEMPLATES,
  ALL_TEMPLATES,
  ALL_TEMPLATES_BUT_DEFAULT
}
