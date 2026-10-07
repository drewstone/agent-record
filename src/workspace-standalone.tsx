import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Workspace } from './Workspace.js'

/** Mounts on `<div id="agent-workspace" data-api data-mode="plays|play|run" data-id>` in a host shell. */
function themeOf(element: HTMLElement): 'light' | 'dark' | 'auto' {
  const declared = element.dataset.theme
  if (declared === 'light' || declared === 'dark') return declared
  // The host sets --ar-background; follow its brightness so native controls match.
  const color = getComputedStyle(element).getPropertyValue('--ar-background').trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1]
  if (!hex) return 'auto'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.5 ? 'dark' : 'light'
}

const element = document.getElementById('agent-workspace')
if (element) {
  const mode = element.dataset.mode === 'overview' ? 'overview' : element.dataset.mode === 'plays' ? 'plays' : element.dataset.mode === 'play' ? 'play' : 'run'
  createRoot(element).render(
    <StrictMode>
      <Workspace api={element.dataset.api ?? '/api/discovery'} mode={mode} id={element.dataset.id ?? ''} theme={themeOf(element)} />
    </StrictMode>,
  )
}
