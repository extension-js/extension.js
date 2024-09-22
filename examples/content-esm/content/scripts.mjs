import {contentComponent} from './contentComponent.mjs'
import './styles.css'

console.log('hello from content_scripts')

document.body.innerHTML += contentComponent
