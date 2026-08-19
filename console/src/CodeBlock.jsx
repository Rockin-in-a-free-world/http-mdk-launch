// Reuses the launcher's own code-block look (src/app.css `.workbench-query-box__code`)
// instead of the unstyled <pre> the docs-react components fall back to when
// no `components.CodeBlock` is supplied.
export function CodeBlock ({ children, className }) {
  return (
    <pre className="workbench-query-box__code console-codeblock">
      <code className={className}>{children}</code>
    </pre>
  )
}
