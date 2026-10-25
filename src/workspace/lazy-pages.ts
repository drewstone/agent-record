import { lazy } from 'react'

// Screens that pull in sandbox-ui (the run workspace's file, code and diff views) or are opened alone (Today): each is a
// chunk of its own under dist/viewer/, loaded when its page opens, so every other page's first file stays small.
export const LazyRunWorkspace = lazy(() => import('./RunWorkspace.js').then((module) => ({ default: module.RunWorkspace })))
export const LazyTodayPage = lazy(() => import('./Today.js').then((module) => ({ default: module.TodayPage })))
// The run's outputs drawer and a version's output changes read files through sandbox-ui's previews and diffs.
export const LazyOutputsView = lazy(() => import('./Outputs.js').then((module) => ({ default: module.OutputsView })))
export const LazyOutputChanges = lazy(() => import('./Outputs.js').then((module) => ({ default: module.OutputChanges })))
