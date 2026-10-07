# KiCad MCP workflow

Open the repository root in VS Code. The local `.vscode/mcp.json` connects
GitHub Copilot Agent mode to the separately installed KiCAD MCP server.
Use **MCP: List Servers** in the Command Palette to start `KiCAD-MCP-Server`
and confirm its tools are available, accepting VS Code's trust prompt if shown.

For a new checkout, copy `.vscode/mcp.example.json` to `.vscode/mcp.json`.
The example assumes the built `KiCAD-MCP-Server` repository is a sibling of
this repository and uses macOS KiCad Python paths. Adjust the Node command,
server entrypoint, `KICAD_PYTHON`, and `PYTHONPATH` to match your installation.
The active configuration is ignored by Git; the example is shared.

The local setup uses `.venv-kicad`, created with KiCad's bundled Python and
`--system-site-packages` so it can import `pcbnew`. To recreate it on macOS:

```bash
/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 -m venv --system-site-packages .venv-kicad
.venv-kicad/bin/python3 -m pip install -r ../KiCAD-MCP-Server/requirements.txt
```

Set `KICAD_PYTHON` in your local `.vscode/mcp.json` to
`${workspaceFolder}/.venv-kicad/bin/python3` when using this environment.

Setup reference:
[KiCAD MCP Server — GitHub Copilot (VS Code)](https://github.com/mixelpixx/KiCAD-MCP-Server/blob/main/README.md#github-copilot-vs-code).

## Existing designs

Specify the exact design before asking the assistant to open or edit it:

| Directory | Project | Board | Schematic |
| --- | --- | --- | --- |
| `90x90cm board` | `S660-PDB.kicad_pro` | `S660-PDB.kicad_pcb` | `S660-PDB.kicad_sch` |
| `109x49cm board` | `S660-PCB-long.kicad_pro` | `S660-PCB-long.kicad_pcb` | `S660-PCB-long.kicad_sch` |
| `smt board` | `S660-PCB-long.kicad_pro` | `S660-PCB-long.kicad_pcb` | `S660-PCB-long.kicad_sch` |
| `smt board` | `S660-PCB-SMT-two-sided.kicad_pro` | `S660-PCB-SMT-two-sided.kicad_pcb` | No matching schematic file |

Example first prompt:

> Use the KiCad MCP tools to open `pdb-circuit/90x90cm board/S660-PDB.kicad_pro`
> with its absolute workspace path. Inspect the board and summarize its
> components, dimensions, and design-rule violations without changing it.

Discover available operations with `search_tools` or `get_category_tools`
before selecting a tool. Open and inspect the chosen design, create a checkpoint
before substantial changes, then save and run the relevant schematic ERC or PCB
DRC checks. Review any unresolved violations before exporting manufacturing files.
Coordinate file edits with the MCP session: close the project before editing its
files externally, then reopen it to avoid saving stale in-memory state.

The configuration leaves automatic GUI launch and development session logging
disabled. To use live PCB interaction, launch KiCad yourself and enable its IPC
API server in Preferences > Plugins. File-based operation does not require the GUI.

This VS Code configuration applies to Copilot. Other MCP clients need their own
server registration; it does not register tools in an already running Codex task.
