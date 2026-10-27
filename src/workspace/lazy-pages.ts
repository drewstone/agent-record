import { createElement, lazy } from 'react'

// Screens that pull in sandbox-ui (the run page's file, code and diff views) or are opened alone (Today): each is a
// chunk of its own under dist/viewer/, loaded when its page opens, so every other page's first file stays small.
// A run page starts its chunk with its document fetch, so it is ready when the data is.
const runPage = () => import('./run/RunPage.js')
if (typeof location !== 'undefined' && location.pathname.startsWith('/run/')) void runPage()
export const LazyRunPage = lazy(() => runPage().then((module) => ({ default: module.RunPage })))
// Today and the operations pages (Fleet, Sandboxes, Ideas) are opened alone, so each is its own chunk.
const wallPages = () => import('./WallPages.js')
const PAGES = {
  today: lazy(() => import('./Today.js').then((module) => ({ default: module.TodayPage }))),
  fleet: lazy(() => wallPages().then((module) => ({ default: module.FleetPage }))),
  sandboxes: lazy(() => wallPages().then((module) => ({ default: module.SandboxesPage }))),
  ideas: lazy(() => wallPages().then((module) => ({ default: module.IdeasPage }))),
}
export type LazyMode = keyof typeof PAGES
export const isLazyMode = (mode: string): mode is LazyMode => mode in PAGES
export const LazyPage = ({ mode, api }: { mode: LazyMode; api: string }) => createElement(PAGES[mode], { api })
// The run's outputs drawer and a version's output changes read files through sandbox-ui's previews and diffs.
export const LazyOutputsView = lazy(() => import('./Outputs.js').then((module) => ({ default: module.OutputsView })))
export const LazyOutputChanges = lazy(() => import('./Outputs.js').then((module) => ({ default: module.OutputChanges })))
