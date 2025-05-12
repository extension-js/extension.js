export type UIContext = 'sidebar' | 'newTab' | 'content' | 'action' | 'devTools';
export type ConfigFiles = 'postcss.config.js' | 'tailwind.config.js' | 'tsconfig.json' | '.stylelintrc.json' | 'extension.config.js' | 'babel.config.json' | '.prettierrc' | 'eslint.config.mjs';
export interface Template {
    name: string;
    uiContext: UIContext[] | undefined;
    uiFramework: 'react' | 'preact' | 'vue' | 'svelte' | undefined;
    css: 'css' | 'sass' | 'less' | 'stylus';
    hasBackground: boolean;
    hasEnv: boolean;
    configFiles: ConfigFiles[] | undefined;
}
