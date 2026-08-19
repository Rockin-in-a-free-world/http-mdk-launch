// A few transitive deps (vfile/unified, pulled in via react-markdown for
// MarkdownDescription; misc lodash/prop-types environment checks) assume a
// Node-style global `process` exists — true under webpack (which
// auto-polyfills it) but not under Vite/Rollup. Minimal shim, just enough
// for `process.env.NODE_ENV`, `process.platform`, and `process.cwd()`
// reads not to throw.
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: { NODE_ENV: 'production' },
    platform: 'browser',
    version: '',
    versions: {},
    cwd: () => '/',
    nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0)
  }
}
