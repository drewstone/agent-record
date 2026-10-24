import { lazy } from 'react'

// Screens that pull in sandbox-ui (the run workspace's file, code and diff views) or are opened alone (Today): each is a
// chunk of its own under dist/viewer/, loaded when its page opens, so every other page's first file stays small.
export const LazyRunWorkspace = lazy(() => import('./RunWorkspace.js').then((module) => ({ default: module.RunWorkspace })))
export const LazyTodayPage = lazy(() => import('./Today.js').then((module) => ({ default: module.TodayPage })))
