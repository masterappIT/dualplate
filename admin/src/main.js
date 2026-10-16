import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles/tokens.css'
import './styles/base.css'
import './styles/materials.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/pages.css'
import { installPressFeedback, installRipple } from './composables/motion'
createApp(App).use(router).mount('#app')
installPressFeedback()
installRipple()
