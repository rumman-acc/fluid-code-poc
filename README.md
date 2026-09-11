# Fluid Agent POC

A minimal, **real** proof of concept for Fluid: a control-plane web UI that drives
a customer's already-authenticated local coding agent (Claude Code or Codex)
against a project that lives on the customer's own filesystem.

Fluid never runs a model itself, never asks for an API key, and never touches
the generated source code except to read it back off disk to show progress.

## Quick start

```bash
npm install
npm start
```

Open **http://localhost:4787** in a browser.

1. Pick **Codex** or **Claude Code** (only agents actually detected on this
   machine, with a real installed version, are selectable).
2. Review/edit the prompt (defaults to the Purchase Order Approval app spec).
3. Click **Start Agent**.
4. Watch **Agent Activity** stream live as the agent reads/writes files in
   `workspace/`.
5. When it finishes, **Generated Application** lists the real files on disk.
   Click **Run Application** to open the generated app, or **Open Workspace**
   to open the folder in Explorer/Finder.
6. Type a follow-up instruction (e.g. "add a search box") and click **Start
   Agent** again — the agent edits the same files in place.

## Hosted Claude-native POC

The customer-facing dashboard is hosted from `mcp-server/` on Render. It does
not download a Fluid executable or show terminal commands. **Connect Claude
Code** creates a 15-minute pairing code and opens the official Claude Code VS
Code deep link with a connection request already filled in. The user reviews
and submits that request inside Claude Code.

The repository is also a Claude plugin marketplace. Its `fluid` plugin bundles
the hosted OAuth-protected MCP server and two skills: connect to Fluid, and
build the current Fluid project. On the first connection, the user approves
adding/installing that plugin in Claude's graphical plugin manager and completes
Fluid authorization in the browser. Later connections go directly to pairing.

Set this variable on the Render web service:

```text
FLUID_BASE_URL=https://fluid-code-poc.onrender.com
```

The hosted flow is intentionally client-initiated: a website cannot silently
install a Claude plugin, submit a Claude prompt, or choose a local workspace.
Those actions remain visible user approvals inside Claude Code/VS Code.

## How agent invocation actually works on this machine

Neither `claude` nor `codex` was on `PATH` here — this machine only has them
via their VS Code extensions (Anthropic's "Claude Code" extension, OpenAI's
"ChatGPT" extension). Both extensions bundle the *real* CLI binary. The
bridge (`server/lib/agentDetect.js`) looks in two places, in order:

1. `claude` / `codex` on `PATH` (a standalone CLI install), else
2. The CLI binary bundled inside the customer's VS Code extension:
   - `~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude.exe`
   - `~/.vscode/extensions/openai.chatgpt-*/bin/windows-x86_64/codex.exe`

Whichever is found is invoked with `--version` to confirm it actually runs
before being offered in the UI. If neither check succeeds, that agent shows
as **Unavailable** with the reason, exactly as required — nothing is faked.

Both binaries use **the customer's own local login** (`~/.claude` /
`~/.codex/auth.json`) — Fluid never sees or stores a credential:

- **Claude Code**: `claude -p --output-format stream-json --verbose --permission-mode acceptEdits "<prompt>"`, spawned with `cwd` = the workspace.
- **Codex**: `codex exec --json -s workspace-write -C <workspace> --skip-git-repo-check "<prompt>"`.

Both flags (`--output-format stream-json`, `--json`) are each CLI's own
**official, supported, non-interactive** output mode — not scraped terminal
output. Each line of stdout is a structured JSON event (tool calls, file
changes, shell commands, final result), which `server/lib/agents/*.js`
parses into the activity log shown in the UI. This was verified against real
captured output from both CLIs before being implemented (see git-free
history — this was live-tested, not assumed from docs).

## Architecture implemented

```
   Browser (Fluid UI)
          │  HTTP + Server-Sent Events (localhost only)
          ▼
   Fluid Local Bridge (Express, server/server.js)
          │  child_process.spawn(exe, args, { cwd: workspace })
          ▼
   Claude Code CLI  /  Codex CLI      (customer's own local auth)
          │  reads/writes files
          ▼
   workspace/                         (real files on the local disk)
          │
          ▼
   Generated App (served back at /app, or opened in Explorer)
```

- `server/lib/agents/CodingAgent.js` — abstract `detect()` / `start()` interface.
- `server/lib/agents/ClaudeCodeAgent.js`, `CodexAgent.js` — concrete drivers.
- `server/lib/agentDetect.js` — finds the real installed/authenticated binary.
- `server/lib/runManager.js` — holds the current run + fans activity events out over SSE.
- `server/server.js` — HTTP API + static hosting of both the Fluid UI (`web/`) and the generated app (`workspace/`, mounted at `/app`).

**Security boundary honored:** the browser only ever talks to
`localhost:4787`. It never sees a file path outside the JSON the bridge
chooses to return, never sees `auth.json`/`.credentials.json`, and no
outbound network call is made by the POC itself other than what the agent
CLI does under its own auth.

## Project layout

```
fluid-agent-poc/
├── server/
│   ├── server.js                 Express app, API, SSE
│   └── lib/
│       ├── agentDetect.js        finds installed/authenticated CLIs
│       ├── runManager.js         run state + event fan-out
│       └── agents/
│           ├── CodingAgent.js    abstract interface
│           ├── ClaudeCodeAgent.js
│           └── CodexAgent.js
├── web/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── workspace/                    the customer's local project (agent writes here)
├── package.json
└── README.md
```

## Phase 2 — evolving into Fluid SaaS

Today `web/` is served by the same local process that spawns the agent. To
become the real architecture:

```
Fluid SaaS (cloud)              →  Project/governance UI, auth, org policy
        │  authenticated session
        ▼
Fluid Local Bridge (unchanged)  →  same server/ code, running on the customer's machine
        │
        ▼
Customer Agent / Local Workspace →  unchanged
```

The only thing that moves is *where the UI is rendered from* — `web/`
becomes a thin client of the SaaS app instead of Express static files, and
it talks to the **local** bridge over a `localhost` (or a signed
loopback/websocket tunnel the customer opts into) connection instead of
being served by it. Concretely:

1. Keep `server/server.js` as a standalone local process ("Fluid Local
   Bridge") — it already has no dependency on being co-hosted with the UI.
2. Replace `web/`'s static hosting with the Fluid SaaS frontend, which the
   customer logs into normally. On load, it discovers the local bridge (a
   fixed local port + a pairing/token step) instead of calling `/api/*` on
   its own origin.
3. The bridge authenticates *that* connection (e.g. a short-lived token
   issued by Fluid SaaS the first time the customer pairs their machine),
   so only the customer's own logged-in Fluid session can drive their own
   local agent — never an arbitrary web origin.
4. Governance (which prompts are allowed, which projects a user can target,
   audit trail of runs) moves into Fluid SaaS and is enforced *before* the
   SaaS UI is allowed to call the bridge — the bridge itself stays a dumb,
   auditable executor.

Nothing about `agentDetect.js`, `CodingAgent`, `ClaudeCodeAgent`,
`CodexAgent`, or `runManager` needs to change for this step.

## Phase 3 — MCP POC

An initial OAuth-protected MCP implementation now lives in `mcp-server/`.
The abstraction remains ready for further tools:
`CodingAgent.start()` already isolates "how we talk to the agent process"
from everything else, so adding MCP means adding a config, not restructuring
the bridge.

Future flow:

```
Coding Agent (Claude Code / Codex)
        │  MCP (already supported natively by both CLIs via `--mcp-config` / `codex mcp`)
        ▼
Fluid MCP Server                    →  new component, sits next to (or inside) Fluid SaaS
        │
        ▼
Fluid SaaS                          →  project requirements, governance policy, approvals
```

Implemented Fluid MCP tools:

- `connect_fluid(pairing_code)` — confirms Claude Code in the waiting browser session
- `get_project_requirements()` — retrieves the current project specification
- `report_agent_activity(message)` — sends structured progress to the Fluid dashboard

Where it sits: the Fluid MCP Server is a Fluid-SaaS-hosted (or edge) service.
Both `claude` and `codex` already support connecting to a remote MCP server
via config (`--mcp-config` / `codex mcp add`), so the local bridge's job in
Phase 3 becomes: fetch a short-lived MCP connection config scoped to the
project from Fluid SaaS, and pass it to the agent CLI at start time — no
change needed to how the agent process itself is spawned.

## Known limitations

- Single active run at a time (matches the POC's one-workspace scope);
  `runManager` stores exactly one run in memory, not a queue.
- Activity parsing keys off `tool_use` / `item.*` event shapes that were
  observed on Claude Code 2.1.266 and Codex CLI 0.154.0-alpha.6.1. A future
  CLI release could rename fields; both drivers fail closed (unparsed JSON
  lines are silently skipped, not guessed at) rather than showing fake
  activity.
- "Open Workspace" shells out to `explorer.exe`/`open`/`xdg-open` with a
  fixed, server-known path — no user input reaches that command.
- No authentication on the local bridge itself yet (matches Phase 1 scope —
  it is `localhost`-only); Phase 2 above is where that gets added.

## POC status

Verified live against this machine (Windows 11, Node v24.16.0) with no API
key configured anywhere in this repo or environment:

```
Fluid UI:             PASS
Local Bridge:         PASS
Codex:                PASS  (codex-cli 0.154.0-alpha.6.1, ChatGPT auth, bundled with VS Code "ChatGPT" extension)
Claude Code:          PASS  (2.1.266, bundled with VS Code "Claude Code" extension)
Local Filesystem:     PASS  (files verified on disk, not just in the UI)
Agent-generated code: PASS  (index.html/styles.css/app.js created by Claude Code, then genuinely edited in place by a second prompt)
Local App Runtime:    PASS  (served at /app, verified 200 OK on all three files)
MCP:                  PASS  (initial OAuth-protected requirements/activity POC)
```
