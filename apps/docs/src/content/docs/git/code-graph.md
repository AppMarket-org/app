---
title: "Code graph"
description: "A map of a repo’s files, what they define and how they import each other, for people and agents."
---

appmarket.org keeps a code graph of each repo's default branch: where functions, classes, types
and constants are defined, and which files import which. Agents use it through MCP tools;
people see it as a map. Only the repo's owners and members can see it.

## The Graph tab

The repo's **Graph** tab draws the files as dots, coloured by folder (the first two levels, so
`apps/api` and `apps/web` differ) and sized by how much they define. Lines are imports between the
repo's own files.

- **Select a file** to light up what it imports and what imports it, with its definitions beside
  the map. **Open** shows it in the code view.
- **What a change affects** switches the highlight to every file a change to it can reach: its
  importers, theirs, and theirs (three steps).
- **Find a symbol** jumps to the file that defines it.
- **Large repos** (over 400 files) start as a map of folders; open a folder to see its files.
- Scroll to zoom, drag to move, and **Fit** to see everything again.

## Beside the code

When you open a TypeScript, JavaScript or Python file in the code view, a **Code graph** panel
lists what the file defines (click one to jump to its line), what it imports, what imports it, and
what a change to it can affect. **Map** opens the Graph tab on that file.

## How it is built

- It covers the head of the default branch and is rebuilt the first time it is needed after the
  branch moves, so the first look after a push can take a few seconds.
- It reads TypeScript/JavaScript and Python with a fast scanner, not a compiler: top-level
  functions, classes, interfaces, types, enums and constants with their line numbers, and imports
  between the repo's own files, including relative paths, `./x.js` for `x.ts`, `index` files and
  Python packages. Imports of other packages are left out.
- It skips files over 256 KB, `node_modules`, build output and virtual environments, and covers at
  most 3,000 files; the Graph tab says when a repo is larger.

## For agents

The `appmarket mcp` server offers `code_find_symbol`, `code_references` and `code_impact`, and
leasing a file that imports, or is imported by, a file another agent holds returns a heads-up. See
[Agents working together](/agents/collaboration/).
