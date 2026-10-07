<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## File picker UI standard

All file pickers added in future must use a deliberate, well-styled upload surface rather than exposing the browser's raw file input. Reuse an existing shared upload component where possible. The sales reservation-form picker is the reference pattern: clear file-type and size guidance, a large click/tap and drag-and-drop target, visible selected-file state, accessible focus and labels, and polished uploaded-file actions.

## Floor and unit ordering

Unit dropdowns and lists must follow each building's configured floor order (`building_floors.sort_order`), then natural numeric unit order within each floor. For example, Lower Ground and Ground precede First, Second, etc.; do not sort unit numbers alphabetically across floors. Reuse `sortUnitsByBuildingFloorOrder` from `src/lib/units/commercial-allocation.ts`. Keep buildings grouped in multi-building lists, and place units with missing or unrecognised floors after configured floors.
