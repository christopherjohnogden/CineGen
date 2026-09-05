# CineGen MCP server

CineGen exposes 35 tools for working conversationally in the desktop app. Claude
can write a script breakdown and shotlist, create approved Elements, generate
Director takes, work in Spaces, edit timelines, and render an export. Project
management also works when the app is at its launcher.

## Setup

Install the repository dependencies with `npm install` if needed, build the updated
app with `npm run build`, and launch it. Restart an older running app to load these
changes. The server uses the repository's installed `zod` dependency to publish the
same input schemas the app validates.

```bash
claude mcp add cinegen -- node /Users/cogden/Desktop/Coding/CineGen/mcp/cinegen-mcp.mjs
```

For Claude Desktop, use this entry in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cinegen": {
      "command": "node",
      "args": ["/Users/cogden/Desktop/Coding/CineGen/mcp/cinegen-mcp.mjs"]
    }
  }
}
```

Reconnect the MCP client after updating so it refreshes the tool list. No new
provider accounts are needed: generation uses the app's existing connections.

## Script to finished takes

1. Use `cinegen_project` to list/open a project, then `cinegen_get_context` and
   `cinegen_capabilities`. Wait for the project to finish loading before editing.
2. Load the full script with `cinegen_load_script`. This disables Director
   auto-sync so the app does not launch additional LLM passes while Claude writes.
3. Read the script and first-pass breakdown, then use `cinegen_set_breakdown` to
   merge corrections. `cinegen_edit_director` can edit individual items and
   `cinegen_delete_director_item` can remove false positives.
4. Show the user the breakdown and wait for their approval. Only then call
   `cinegen_approve_breakdown` with the selected item IDs and `approved: true`.
   It creates or reuses Elements and links them to the breakdown. Retrying it does
   not duplicate the linked Elements. Creating an Element does not generate its
   reference image: generate or import images, then attach them with
   `cinegen_edit_element`.
5. Read the exact shotlist writing instructions from `cinegen_capabilities`.
   Send the resulting JSON to `cinegen_set_shotlist`. The JSON has **top-level
   `scenes` and `clips` arrays**, not clips nested inside scenes.
6. Read Director to inspect clip IDs, adjust camera/acting/settings, or choose an
   isolated beat. `cinegen_generate_shots` now uses the **actual Director
   generation pipeline**: reference images, provider settings, take tracking,
   prompt snapshots and media-pool folders are preserved. It returns an MCP job
   ID. Poll `cinegen_get_jobs`, then read Director and assets for the takes.
7. Pick hero takes with `cinegen_take`, construct a timeline with
   `cinegen_set_timeline`, and render with `cinegen_export`.

Claude does the writing when using the import/edit tools. Explicit
`cinegen_director_action` calls can instead run the app's own LLM jobs. Generation
and those LLM jobs may spend provider credits; use them only within the user's
requested scope. An approval boolean communicates the client's decision; it is
not an independent app confirmation dialog.

## Tool coverage

| Area | Tools and behavior |
| --- | --- |
| Discovery | `cinegen_get_context` gives a summary. `cinegen_read` returns complete Director, Element, Space, asset, timeline, export or folder records. `cinegen_capabilities` gives adapter IDs, storyboard IDs and shotlist instructions. |
| Projects | `cinegen_project`: list, create, open, save, close, delete. Switching saves the current project and Element library first; save failures prevent switching. Close before deleting a project. |
| Navigation | `cinegen_navigate`: app tab, existing Space, timeline, Studio or Canvas. |
| Elements | `cinegen_create_element`, `cinegen_edit_element`, `cinegen_delete_element`: names, descriptions, reference images, continuity variations, default variation and folders. |
| Breakdown | `cinegen_load_script`, `cinegen_set_breakdown`, `cinegen_approve_breakdown`: parse, refine, approve and link Elements. |
| Director editing | `cinegen_set_shotlist`, `cinegen_edit_director`, `cinegen_delete_director_item`: show settings, look bible, scenes, clip beats, camera, acting, queues, isolation and prompt overrides. |
| Director operations | `cinegen_generate_shots`, `cinegen_director_action`: real take generation, storyboard generation, app LLM breakdown/shotlist/notes/look bible, staging, and take recovery. |
| Takes/storyboards | `cinegen_take`: hero, notes, removal. `cinegen_storyboard`: read plan, edit prompt, attach image. `cinegen_framing`: apply or clear a saved framing. |
| Background jobs | `cinegen_get_jobs`: running/completed/failed MCP Director jobs, results and errors. Jobs live for the current project session. |
| One-off generation | `cinegen_list_models`, `cinegen_generate`, `cinegen_get_generations`: generate images/video with Element references and up to four versions. Destination `spaceId` and `view` are optional. |
| Spaces | `cinegen_create_space`: templates. `cinegen_space`: empty Space, rename, duplicate, delete. |
| Canvas | `cinegen_list_node_types`, `cinegen_nodes`, `cinegen_connect`: discover all available node types and controls, create/configure/run/remove nodes, connect ports, place Studio generations on Canvas or hide them again. |
| Media | `cinegen_asset`, `cinegen_folder`, `cinegen_extract_media`: media-pool entries, folders, extracting a frame or clip. Removing an entry does not delete the source file. |
| Edit | `cinegen_timeline`, `cinegen_set_timeline`: create/duplicate/rename/delete timelines; edit tracks, clips, trims, timing, speed, flips, opacity, audio, keyframes, transitions and markers. Read a timeline before replacing it. Referenced assets and tracks are validated. |
| Export | `cinegen_export`: start, poll, cancel using the app export engine. Poll for the output path and completion. |
| History | `cinegen_history`: undo/redo workspace changes. Does not cancel jobs or refund credits. |

For a one-off request, pass `spaceId` to choose the destination and `view: "canvas"`
to place its generation and reconstructed inputs on Canvas. `view: "studio"`
opens the Studio feed. A generation completing after a Space switch updates its
original Space. `cinegen_get_generations` reads the active Space; use
`cinegen_read` to inspect another Space.

## Boundaries

This is broad production-workflow coverage, not a promise that every UI gesture
has a corresponding tool. Account sign-in, credential entry, device/Pod setup,
and application-level preferences remain app controls. Editor playback and
interactive tools are represented through editable timeline data, rather than
mouse/keyboard automation. Some specialized Director data (for example creating
arbitrary staging-map geometry) is not directly editable by MCP yet.

Exports have the same renderer capabilities and limitations as the app. MCP does
not add rendering support for a field merely because the timeline can store it.
The server does not expose arbitrary JavaScript, shell commands or raw Electron
IPC. Standard edits follow the app's normal autosave and undo behavior.

## Connection and troubleshooting

The stdio server forwards authenticated HTTP requests over `127.0.0.1` to the
app. On launch the app writes an ephemeral port and random token to
`~/Documents/CINEGEN/mcp-bridge.json` with `0600` permissions. Set
`CINEGEN_MCP_BRIDGE_FILE` to use another discovery file. No fixed port is needed.

- **CineGen is not running:** open the updated desktop app.
- **No project is open / still loading:** use `cinegen_project` to open one, wait
  for loading, and retry. All other tools require a loaded project.
- **Old tools or behavior:** rebuild/restart CineGen and reconnect Claude's MCP.
- **Director action still running:** poll `cinegen_get_jobs` before starting
  another. The controls must remain available while a job runs; the app keeps
  Director mounted after its first visit so switching tabs does not lose updates.
- **Unknown node/model/adapter:** use the discovery tools; do not guess IDs.

## Development

`mcp/tool-catalog.mjs` advertises the original tools. `mcp/edit-schemas.mjs` declares
the new schemas once, for both discovery and runtime validation. Handlers live in
`src/lib/mcp/handlers.ts` and `edit-handlers.ts`. Panel commands register in
`app-commands.ts`; the bridge runs long Director calls as background jobs.
`cinegen_project` is handled by `App` so it works outside a workspace.

The MCP tests cover catalogue parity, validation, approval and linking, Canvas
placement, generation routing, timeline integrity, background jobs, project
switching and results arriving after switching Spaces. Provider generation is
mocked in tests; live paid generations are not part of verification.
