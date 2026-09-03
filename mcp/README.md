# CineGen MCP server

Talk to Claude, and it works in your open CineGen project: reads what is there,
writes Elements and Spaces, breaks down a script, imports a shot list, and starts
generations. Switch to the app and the results are waiting.

## Setup

CineGen must be running with a project open — the tools act on that project, and
generation uses the app's provider connections.

```bash
claude mcp add cinegen -- node /Users/cogden/Desktop/Coding/CineGen/mcp/cinegen-mcp.mjs
```

For Claude Desktop, add the same command to `claude_desktop_config.json`:

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

Nothing to install: the server is one file with no dependencies.

## The tools

| Tool | What it does |
| --- | --- |
| `cinegen_get_context` | The open project: Spaces, Elements, timelines, Director state, recent generations. Call it first. |
| `cinegen_list_models` | Video or image models, with what each accepts (duration, references, frames). |
| `cinegen_generate` | Generate images or video, up to four versions at once, optionally referencing Elements by name. |
| `cinegen_get_generations` | Recent generations with status and media URL. Poll this after generating. |
| `cinegen_create_space` | Build a Space from a template, pre-filled with a list of shot prompts. |
| `cinegen_create_element` | Create a character, location, prop or vehicle. |
| `cinegen_load_script` | Load a script and get back the deterministic scene split and first-pass breakdown. |
| `cinegen_set_breakdown` | Replace that first pass with a better reading of the script. |
| `cinegen_set_shotlist` | Import a shot list into Director. |
| `cinegen_generate_shots` | Generate video for shots in the shot list, using each clip's compiled prompt. |

## How the work is divided

The tools are deterministic app operations. The thinking stays with the model on
the other end: it reads the script, writes the breakdown, invents the shot list,
and phrases the prompts. That is why `cinegen_load_script` hands back its
deterministic first pass and expects a better one in return — the app does not
spend provider credits on a second-rate LLM call when a good writer is already
holding the conversation.

## How it connects

```
Claude ── stdio ──▶ cinegen-mcp.mjs ── HTTP 127.0.0.1 ──▶ CineGen main process ── IPC ──▶ workspace
```

On launch the app opens a loopback HTTP server on an ephemeral port and writes
the port and a random token to `~/Documents/CINEGEN/mcp-bridge.json` with `0600`
permissions. The server reads that file, so there is nothing to configure and no
port to keep in sync. Only a process running as you can read the token, and the
listener is bound to `127.0.0.1`.

Set `CINEGEN_MCP_BRIDGE_FILE` to point at a different discovery file.

## When something is not working

- **"CineGen is not running"** — the app is closed, or it never wrote the
  discovery file. Start the app.
- **"No CineGen project is open"** — the app is on the project launcher. Open a
  project.
- **"The CineGen bridge rejected this token"** — the app restarted after this
  server started. It re-reads the file per call, so this clears on the next try.

## Adding a tool

1. Describe it in `tool-catalog.mjs`.
2. Implement it in `src/lib/mcp/handlers.ts`, keyed by the same name.
3. `tests/lib/mcp/catalog.test.ts` fails if the two disagree.

Handlers take a host (state, dispatch, runNode), so they are tested without a
renderer and would work unchanged in a headless host.
