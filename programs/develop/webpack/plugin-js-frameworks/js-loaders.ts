// // ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// // ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// // ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// // ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// // ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// // ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

// import {babelConfig} from './js-tools/babel'
// import {isUsingTypeScript} from './js-tools/typescript'
// import {isUsingVue} from './js-tools/vue'

// type Loader = Record<string, any>

// const vueLoaders = (projectPath: string): Loader[] => {
//   const vueLoaders: Loader[] = [
//     {
//       test: /\.vue$/,
//       loader: require.resolve('vue-loader')
//     }
//   ]

//   // use vue and typescript, need to add ts-loader
//   if (isUsingTypeScript(projectPath)) {
//     vueLoaders.push({
//       test: /\.ts?$/,
//       loader: require.resolve('ts-loader'),
//       options: {
//         appendTsSuffixTo: [/\.vue$/],
//         // Skip type checking
//         transpileOnly: true
//       }
//     })
//   }

//   return vueLoaders
// }

// export default function jsLoaders(projectPath: string, opts: any) {
//   // Prevent users from running ts/tsx files when not using TypeScript
//   // const files = isUsingTypeScript(projectPath)
//   //   ? /\.(js|mjs|jsx|mjsx|ts|mts|tsx|mtsx)$/
//   //   : /\.(js|mjs|jsx|mjsx)$/

//   // "babel-loader": "^9.1.3",
//   // "babel-preset-modern-browser-extension": "^0.7.0",

//   const jsLoaders: Loader[] = [

//   ]

//   // Add vue-loader when using vue
//   // isUsingVue(projectPath) && jsLoaders.push(...vueLoaders(projectPath))

//   return jsLoaders
// }
