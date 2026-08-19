// Stub for 'react-syntax-highlighter'. @metamask/open-rpc-docs-react's
// MarkdownDescription component imports the package's full `Prism` bundle,
// which does a synchronous `require('prismjs/components/prism-<lang>')' for
// every one of its ~200 supported languages at module-load time — a bare
// CJS pattern Rollup doesn't fully convert for a browser build, so it blows
// up immediately with "require is not defined". MarkdownDescription only
// renders inline code spans inside method/param prose here (the real
// JSON-RPC examples go through our own CodeBlock — console/src/CodeBlock.jsx
// — via the `components` prop), so full syntax highlighting buys nothing;
// swap in a plain <code> instead of paying for the whole language bundle.
// Written with createElement (not JSX) so this file can stay a plain .js
// module regardless of the build's per-extension JSX-parsing rules.
import { createElement } from 'react'

export function Prism ({ children, className }) {
  return createElement('code', { className }, children)
}

export default Prism
