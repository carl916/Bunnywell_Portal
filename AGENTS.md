<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## File picker UI standard

All file pickers added in future must use a deliberate, well-styled upload surface rather than exposing the browser's raw file input. Reuse an existing shared upload component where possible. The sales reservation-form picker is the reference pattern: clear file-type and size guidance, a large click/tap and drag-and-drop target, visible selected-file state, accessible focus and labels, and polished uploaded-file actions.
