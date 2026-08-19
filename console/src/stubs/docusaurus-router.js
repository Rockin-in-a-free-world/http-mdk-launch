// Stub for '@docusaurus/router'. @metamask/open-rpc-docs-react's index.js
// unconditionally `require()`s InteractiveMethod.js (a MetaMask-wallet
// "Send Request via window.ethereum" form we don't use — we render `Method`
// for docs and @open-rpc/inspector for the real try-it panel instead), and
// that file top-level-imports '@docusaurus/router' for a couple of hooks it
// only *calls* inside its own render body. Since InteractiveMethod is never
// mounted here, real Docusaurus routing is never needed — this stub just
// lets the module graph resolve without pulling in Docusaurus itself.
export function useHistory () {
  return { push () {}, replace () {} }
}

export function useLocation () {
  return { pathname: '', search: '', hash: '' }
}
