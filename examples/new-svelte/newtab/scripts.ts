import * as svelte from 'svelte'
import './styles.css'
import App from './NewTabApp.svelte'

const container = document.getElementById('app')
const app = svelte.mount(App, {
  target: container as HTMLElement
})

export default app
