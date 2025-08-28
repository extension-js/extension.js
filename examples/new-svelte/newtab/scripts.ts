import * as svelte from 'svelte'
import './styles.css'
import App from './NewTabApp.svelte'

const container = document.getElementById('app')
const app = svelte.mount(App, {
  target: container as HTMLElement
})

export default app

// Enable reliable HMR for the new tab entry
if (import.meta.webpackHot) {
  import.meta.webpackHot.accept('./NewTabApp.svelte', async () => {
    const el = document.getElementById('app') as HTMLElement | null
    if (!el) return
    el.innerHTML = ''
    const mod = await import('./NewTabApp.svelte')
    const NextApp = (mod as any).default || App
    svelte.mount(NextApp, {target: el})
  })

  import.meta.webpackHot.dispose(() => {
    const el = document.getElementById('app') as HTMLElement | null
    if (el) el.innerHTML = ''
  })
}
