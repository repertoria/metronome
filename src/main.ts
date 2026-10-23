import { App as NativeApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import m from 'mithril'
import './style.css'
import { goBack, init, openPattern, setTab, state } from './state.ts'
import { icon } from './ui/common.ts'
import { PatternView, Transport } from './ui/pattern.ts'
import { SimpleView } from './ui/simple.ts'

const tab = (id: typeof state.tab, label: string, ico: () => m.Vnode) =>
  m('button', { type: 'button', class: state.tab === id ? 'on' : '', 'aria-current': state.tab === id ? 'page' : undefined, onclick: () => setTab(id) },
    [ico(), m('span', label)])

// Scroll back to the top when moving between screens.
let lastScreen = ''
const resetScroll = ({ dom }: { dom: Element }) => {
  const screen = [state.tab, state.openId, state.editing].join('/')
  if (screen !== lastScreen) dom.scrollTop = 0
  lastScreen = screen
}

const App: m.Component = {
  view: () =>
    m('.app', [
      m('main.screen', { oncreate: resetScroll, onupdate: resetScroll }, m(state.tab === 'simple' ? SimpleView : PatternView)),
      state.tab === 'pattern' && openPattern() && m(Transport),
      m('nav.tabs', [tab('simple', 'Metronome', icon.metronome), tab('pattern', 'Pattern', icon.blocks)]),
    ]),
}

void init().then(() => m.mount(document.getElementById('app')!, App))

// Android back: close an open sheet, then step back through the screens, then
// leave the app in the background rather than quitting it.
if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener('backButton', () => {
    const backdrop = document.querySelector<HTMLElement>('.sheet-backdrop')
    if (backdrop) backdrop.click()
    else if (!goBack()) void NativeApp.minimizeApp()
    m.redraw()
  })
}

// Space bar toggles playback on desktop.
document.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement
  if (e.code !== 'Space' || el.tagName === 'INPUT' || el.tagName === 'BUTTON') return
  e.preventDefault()
  ;(document.querySelector('.play') as HTMLButtonElement | null)?.click()
})
