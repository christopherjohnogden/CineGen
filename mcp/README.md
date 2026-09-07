# CineGen MCP server

CineGen exposes 38 tools for working conversationally in the desktop app. Claude
can write a script breakdown and shotlist, create approved Elements, generate
Director takes, work in Spaces, edit timelines, and render an export. Project
management also works when the app is at its launcher.

## Setup

**Recommended:** in the installed Mac app, open **Settings → App Settings →
Claude Desktop** and click **Connect Claude Desktop**. Setup preserves your other
Claude servers and preferences and saves a private backup before editing the
configuration. It installs a standalone server using CineGen's bundled runtime;
no Terminal commands, Node installation, or source checkout are needed.

Fully quit and reopen Claude Desktop, then start a new chat. Check **Claude →
Settings → Developer → Local MCP servers** for `cinegen`. This local setup is
separate from remote entries in the Connectors directory and is for Desktop chat,
not web, iPhone or Cowork. Keep CineGen running.

The same card offers **Check setup**, **Repair Claude setup**, **Show
configuration**, and **Disconnect**. Use Repair after moving/updating the app.
Install CineGen in Applications before connecting; do not set it up from a DMG.
Setup verifies server startup and configuration, not whether Claude has restarted
and loaded the tools. Generation remains subject to the connected provider.

### Manual setup for a source checkout

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
   reference image: use `cinegen_build_element` to generate or import its
   reference pack, review the completed job, then `cinegen_approve_element`.
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

## Element reference workflow

1. Call `cinegen_element_models` for supported model keys and providers.
2. Call `cinegen_build_element` with a creative brief (or existing `elementId`)
   and `reference` settings. Modes are `generate`, `guide` (with `guideImages`),
   and `upload` (with `uploadUrls`). Choose a `workingLook` and optionally add
   continuity `variations`, each with its own reference settings. Generation
   defaults to seven views; `views` can limit this to one through seven.
3. Poll `cinegen_get_jobs`. Completed results contain the draft with stable image
   IDs and references ingested into project storage. Generation uses the same
   prompt and provider helpers as the Element modal; both paths share ingestion.
4. Show the draft to the user. After approval, call `cinegen_approve_element` with
   `jobId` and `approved: true`. This adds or updates the Element. If the user
   already explicitly authorized the finished result, `approve: true` on the
   build call can save it immediately after successful ingestion.

Drafts and jobs last for the current project session. Approval refuses to overwrite
an Element changed since its build started. Approval is the save action, not a
separate stored approval flag. `cinegen_read` exposes the implicit Hero / Clean
look for older Elements that only stored a flat image array.

To repair a temporary provider URL without generating again, build the existing
Element using `mode: "upload"` and its URLs, then review and approve. Direct
create/edit calls with references also ingest them before updating the workspace.
The build tool creates reference packs; interactive character casting selection
remains in the modal.

## Tool coverage

| Area | Tools and behavior |
| --- | --- |
| Discovery | `cinegen_get_context` gives a summary. `cinegen_read` returns complete Director, Element, Space, asset, timeline, export or folder records. `cinegen_capabilities` gives adapter IDs, storyboard IDs and shotlist instructions. |
| Projects | `cinegen_project`: list, create, open, save, close, delete. Switching saves the current project and Element library first; save failures prevent switching. Close before deleting a project. |
| Navigation | `cinegen_navigate`: app tab, existing Space, timeline, Studio or Canvas. |
| Elements | `cinegen_element_models`, `cinegen_build_element`, `cinegen_approve_element`: build durable reference packs and review/save drafts. `cinegen_create_element`, `cinegen_edit_element`, `cinegen_delete_element`: names, descriptions, reference images, continuity variations, default variation and folders. |
| Breakdown | `cinegen_load_script`, `cinegen_set_breakdown`, `cinegen_approve_breakdown`: parse, refine, approve and link Elements. |
| Director editing | `cinegen_set_shotlist`, `cinegen_edit_director`, `cinegen_delete_director_item`: show settings, look bible, scenes, clip beats, camera, acting, queues, isolation and prompt overrides. |
| Director operations | `cinegen_generate_shots`, `cinegen_director_action`: real take generation, storyboard generation, app LLM breakdown/shotlist/notes/look bible, staging, and take recovery. |
| Takes/storyboards | `cinegen_take`: hero, notes, removal. `cinegen_storyboard`: read plan, edit prompt, attach image. `cinegen_framing`: apply or clear a saved framing. |
| Background jobs | `cinegen_get_jobs`: running/completed/failed MCP Director and Element jobs, results and errors. Jobs live for the current project session. |
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

## Spaces Studio creation

Use `cinegen_studio_create` to prepare Studio items without starting generation or spending credits. Supply a prompt, optional destination `spaceId`, model name/node type, `inputs` keyed by model field IDs, and optional Element names. Remote calls also require `projectId`. Use `cinegen_list_node_types` to discover preparation models and controls. These items carry Studio metadata, retain their prompt and settings, and can be placed on Canvas later.

Use `cinegen_generate` for actual Studio generation. Topview is the default for preparation and generation. Pass `provider: "higgsfield"` only when the user explicitly requests Higgsfield. Remote generation uses the existing CineGen website connections and does not require a fal key. `cinegen_nodes` remains the explicit Canvas creation path. Reconnect the MCP client to refresh its tool list after an update.


### Creative library (stdio 0.6.11 / remote 1.6.12)

The shared MCP Apps viewer now browses uploaded assets, exact ordered batches, reference Elements and illustrated film presets. Users can send exact selections/prompts back to chat or add existing image/video references to a Studio Space without generating. See [the remote display documentation](../remote/README.md#creative-library-and-inline-displays-server-168) for tool arguments, host compatibility and media limitations. The widget resource is `ui://cinegen/media-viewer-v13.html`; cached v1/v2/v3/v4/v5/v6/v7/v8/v9/v10/v11/v12 URIs also serve the fixed viewer. The browser script is built separately from the server to keep deployment transforms from breaking widget startup.

### Seedance audio references

Topview Seedance 2.5 accepts image, video, and audio guidance. `cinegen_list_models` now advertises `audio_references` (an array of MP3/WAV URLs), alongside the existing mixed `image_url` / `extra_images` inputs. Audio guidance is separate from `generate_audio` (output sound). Studio preparation, generation, and Canvas execution retain the references; Studio's device picker includes audio.

Seedance 2.5 audio-reference generations now use Topview’s Canvas MCP tools with the existing connection when the standalone video tool omits audio. CineGen checks the live Canvas capability, uploads typed references, submits once with an idempotency key, and stores the Canvas/node/task receipt for background polling. Completed videos are retrieved through authorized download artifacts and saved to CineGen Studio. This route currently requires at least one image or video alongside audio; it preserves requested resolution, duration, and output-sound settings. `cinegen_list_models.audioReferenceConnection` advertises the route and the visual-reference requirement. Existing API-key connections retain the REST fallback when Canvas tools are unavailable. No credentials or providers are switched automatically.

The live Topview Canvas submit schema currently limits audio-route prompts to 4,000 characters. CineGen reads this limit from that endpoint, reports it in `audioReferenceConnection.promptMaxCharacters`, and rejects oversized audio-route requests before creating Canvas nodes or uploading references. It does not truncate prompts or apply that limit to Studio preparation, ordinary image/video generation, or other routes. Assistants must preserve the original prompt and ask before shortening it.

### Character voice and ElevenLabs audio

Character Elements now have a voice section: a vocal description, ElevenLabs voice ID/name, sample dialogue and saved audio. Claude can write these through `cinegen_create_element` or `cinegen_edit_element` (`patch.voice`). Use the user's ElevenLabs MCP to design/select a voice or generate audio; then use `cinegen_audio` to attach its result durably. `cinegen_audio` can also prepare/read ElevenLabs speech and sound-effect briefs on Canvas. It never generates or charges credits itself. In the app, the character editor and ElevenLabs Audio node copy the matching Claude brief and accept uploaded audio. The node outputs audio for video reference ports. Character voice direction is automatically included in video prompts when the character is referenced.


### Direct ElevenLabs audio

ElevenLabs Audio nodes now run inside CineGen. Connect an ElevenLabs API key in the node or character voice panel; the key is validated and encrypted in the workspace vault. Speech uses the saved character voice or selected ElevenLabs voice with Eleven v3; sound effects use Eleven Sound Effects v2. The result plays on the node and is saved to Firebase, with a recoverable copy in Cloudflare R2. No Claude handoff is needed. Character editors can design voice previews, choose/save a voice, and generate sample dialogue inside the app.

`cinegen_audio` supports `prepare`, `read`, `generate`, and `attach`. For `generate`, supply an existing audio `nodeId` and a unique `requestId`; reuse that ID to retrieve or finish saving the same paid take. A new request ID submits another generation. The provider's 5,000-character Eleven v3 limit includes performance tags; dialogue is never truncated. Voice description remains separate from spoken dialogue.
