import { createElement, lazy } from 'react'

// Screens that pull in sandbox-ui (the run page's file, code and diff views) or are opened alone (Today): each is a
// chunk of its own under dist/viewer/, loaded when its page opens, so every other page's first file stays small.
// A chunk that fails to load (a deploy replaced its hash, or the network dropped: 22a at 390 rendered only the nav on
// 1 of 10 loads, 10-27) stays failed for the page's life, since the browser caches a failed module, and React then
// unmounts the page. Reload once a minute at most; a second failure inside that minute is thrown, not looped.
export const reloadOnce = (error: unknown): Promise<never> => {
  let last = 0; try { last = Number(sessionStorage.getItem('ar-chunk-reload')) || 0; sessionStorage.setItem('ar-chunk-reload', String(Date.now())) } catch {}
  if (typeof location === 'undefined' || Date.now() - last <= 60_000) return Promise.reject(error)
  location.reload()
  return new Promise<never>(() => {})
}
// A run page starts its chunk with its document fetch, so it is ready when the data is.
const runPage = () => import('./run/RunPage.js').catch(reloadOnce)
if (typeof location !== 'undefined' && location.pathname.startsWith('/run/')) void runPage()
export const LazyRunPage = lazy(() => runPage().then((module) => ({ default: module.RunPage })))
// Today and the operations pages (Fleet, Sandboxes, Ideas) are opened alone, so each is its own chunk.
const wallPages = () => import('./WallPages.js').catch(reloadOnce)
const PAGES = {
  live: lazy(() => import('./LiveRun.js').catch(reloadOnce).then((module) => ({ default: module.LiveRun }))),
  today: lazy(() => import('./Today.js').catch(reloadOnce).then((module) => ({ default: module.TodayPage }))),
  fleet: lazy(() => wallPages().then((module) => ({ default: module.FleetPage }))),
  sandboxes: lazy(() => wallPages().then((module) => ({ default: module.SandboxesPage }))),
  ideas: lazy(() => wallPages().then((module) => ({ default: module.IdeasPage }))),
}
export type LazyMode = keyof typeof PAGES
export const isLazyMode = (mode: string): mode is LazyMode => mode in PAGES
export const LazyPage = ({ mode, api }: { mode: LazyMode; api: string }) => createElement(PAGES[mode], { api })
// The run's outputs drawer and a version's output changes read files through sandbox-ui's previews and diffs.
export const LazyOutputsView = lazy(() => import('./Outputs.js').catch(reloadOnce).then((module) => ({ default: module.OutputsView })))
export const LazyOutputChanges = lazy(() => import('./Outputs.js').catch(reloadOnce).then((module) => ({ default: module.OutputChanges })))
