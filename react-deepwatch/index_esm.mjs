// A wrapper file for ESM to avoid the 'dual package hazard'. See https://nodejs.org/api/packages.html#approach-1-use-an-es-module-wrapper



import cjsIndex from "./index.js"
export const watchedComponent = cjsIndex.watchedComponent
export const watched = cjsIndex.watched
export const useWatchedState = cjsIndex.useWatchedState
export const load = cjsIndex.load
export const isLoading = cjsIndex.isLoading
export const loadFailed = cjsIndex.loadFailed
export const poll = cjsIndex.poll
export const debug_tagComponent = cjsIndex.debug_tagComponent

