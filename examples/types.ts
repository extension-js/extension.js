export type UIContext = 'sidebar' | 'newTab' | 'content' | 'popup' | 'devTools'
export type ConfigFiles =
  | 'postcss.config.js'
  | 'tailwind.config.js'
  | 'tsconfig.json'
  | 'babel.config.js'
  | 'stylelint.config.json'
  | 'extension.config.js'

export interface Template {
  name: string
  uiContext: UIContext[] | undefined
  uiFramework: 'react' | 'preact' | 'vue' | undefined
  css: 'css' | 'sass' | 'less' | 'stylus'
  hasBackground: boolean
  hasEnv: boolean
  configFiles: ConfigFiles[] | undefined
}
