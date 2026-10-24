import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './shared-file-ui.css?inline'

let sharedStyles: CSSStyleSheet | undefined

/** Consume the shared stylesheet without letting its application reset change the embedding product's chrome. */
export function SharedFileUi({ children, theme, style }: { children: ReactNode | ((mode: 'light' | 'dark') => ReactNode); theme?: 'light' | 'dark'; style?: CSSProperties }) {
  const host = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<ShadowRoot | null>(null)
  const [inheritedMode, setInheritedMode] = useState<'light' | 'dark'>('light')
  const [inlineStyles, setInlineStyles] = useState(false)
  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' })
    if ('adoptedStyleSheets' in shadow && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
      if (!sharedStyles) { sharedStyles = new CSSStyleSheet(); sharedStyles.replaceSync(styles) }
      shadow.adoptedStyleSheets = [sharedStyles]
    } else setInlineStyles(true)
    setRoot(shadow)
    const readMode = () => {
      const scheme = getComputedStyle(element).colorScheme
      setInheritedMode(scheme === 'dark' || (scheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')
    }
    readMode()
    const owner = element.closest('[data-theme]')
    const observer = new MutationObserver(readMode)
    if (owner) observer.observe(owner, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    const preference = window.matchMedia('(prefers-color-scheme: dark)')
    preference.addEventListener('change', readMode)
    return () => { observer.disconnect(); preference.removeEventListener('change', readMode) }
  }, [])
  const mode = theme ?? inheritedMode
  return <div ref={host} style={{ minWidth: 0, ...style }} data-shared-file-ui>
    {root && createPortal(<>{inlineStyles && <style>{styles}</style>}<div data-sandbox-ui data-theme={mode} style={{ height: '100%', minHeight: '100%', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>{typeof children === 'function' ? children(mode) : children}</div></>, root)}
  </div>
}
