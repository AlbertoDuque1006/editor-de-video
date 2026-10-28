import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Mac y Windows tienen barras de ventana distintas; el color de resalte es el que eligió la persona en el sistema.
const root = document.documentElement
root.classList.add(window.api.platform === 'darwin' ? 'mac' : 'win')
void window.api.accentColor().then((c) => c && root.style.setProperty('--accent', c))
window.api.onFullscreen((on) => root.classList.toggle('fullscreen', on))

createRoot(document.getElementById('root')!).render(<App />)
