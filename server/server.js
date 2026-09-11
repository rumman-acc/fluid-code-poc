'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ClaudeCodeAgent = require('./lib/agents/ClaudeCodeAgent');
const CodexAgent = require('./lib/agents/CodexAgent');
const runManager = require('./lib/runManager');
const claudeConnect = require('./lib/claudeConnect');

const PORT = process.env.PORT || 4787;
const PROJECT_ROOT = path.join(__dirname, '..');
const WORKSPACE_DIR = path.join(PROJECT_ROOT, 'workspace');

fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

const agents = {
  'claude-code': new ClaudeCodeAgent(),
  codex: new CodexAgent(),
};

const DEFAULT_PROMPT = `Build a simple, polished Purchase Order Approval web application.

Requirements:

1. Create index.html, styles.css and app.js.
2. Show a list of purchase orders.
3. Each purchase order should show:
   - PO number
   - vendor
   - amount
   - status
   - date
4. Add Approve and Reject buttons.
5. Update the status in the UI when a button is clicked.
6. Add a simple dashboard showing:
   - Total POs
   - Pending
   - Approved
   - Rejected
7. Make the UI responsive.
8. Do not use a backend or external API for this first test.
9. Keep the implementation simple and understandable.
10. Run any appropriate validation/tests available locally.
11. Put all source files in the current workspace.`;

const app = express();
app.use(express.json({ limit: '256kb' }));

// ---- Fluid UI (static) ----
app.use(express.static(path.join(PROJECT_ROOT, 'web')));

// ---- Generated app preview: serves the workspace as a static site ----
app.use('/app', express.static(WORKSPACE_DIR));

// ---- Init: workspace path + agent availability + default prompt ----
app.get('/api/init', async (req, res) => {
  const [claudeCode, codex] = await Promise.all([
    agents['claude-code'].detect(),
    agents.codex.detect(),
  ]);
  res.json({
    workspacePath: WORKSPACE_DIR,
    projectRoot: PROJECT_ROOT,
    defaultProjectName: 'My Test Application',
    defaultPrompt: DEFAULT_PROMPT,
    agents: { 'claude-code': claudeCode, codex },
  });
});

// ---- Start Agent ----
app.post('/api/agent/start', async (req, res) => {
  const { agentId, prompt, projectName } = req.body || {};

  if (!agents[agentId]) {
    return res.status(400).json({ error: `Unknown agent "${agentId}"` });
  }
  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  if (runManager.isBusy()) {
    return res.status(409).json({ error: 'An agent run is already in progress' });
  }

  const agent = agents[agentId];
  const info = await agent.detect();
  if (!info.available) {
    return res.status(409).json({ error: `${agent.name} is not available: ${info.reason}` });
  }

  const run = runManager.createRun(agentId, prompt);
  res.json({ runId: run.id, workspacePath: WORKSPACE_DIR });

  const onEvent = (event) => runManager.pushEvent(run.id, event);

  runManager.pushEvent(run.id, { type: 'log', message: `Project: ${projectName || 'Untitled'}` });

  agent
    .start(WORKSPACE_DIR, prompt, onEvent)
    .then((result) => runManager.finish(run.id, result))
    .catch((error) => runManager.finish(run.id, { success: false, error }));
});

// ---- Agent Activity stream (SSE) ----
app.get('/api/agent/events', (req, res) => {
  const { runId } = req.query;
  const run = runManager.getRun(runId);
  if (!run) {
    res.status(404).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders && res.flushHeaders();

  const send = (eventName, data) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Replay history so late/reconnecting clients see everything.
  for (const evt of run.events) send('activity', evt);
  if (run.status !== 'running') {
    send('done', { status: run.status, result: run.result, error: run.error });
    res.end();
    return;
  }

  const onActivity = (evt) => send('activity', evt);
  const onDone = (finishedRun) => {
    send('done', { status: finishedRun.status, result: finishedRun.result, error: finishedRun.error });
    cleanup();
    res.end();
  };
  const cleanup = () => {
    runManager.off(`event:${runId}`, onActivity);
    runManager.off(`done:${runId}`, onDone);
  };

  runManager.on(`event:${runId}`, onActivity);
  runManager.on(`done:${runId}`, onDone);
  req.on('close', cleanup);
});

// ---- Generated files list ----
app.get('/api/workspace/files', (req, res) => {
  const files = [];
  const walk = (dir, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else {
        const stat = fs.statSync(abs);
        files.push({ path: relPath.replace(/\\/g, '/'), size: stat.size, mtime: stat.mtime });
      }
    }
  };
  walk(WORKSPACE_DIR, '');
  files.sort((a, b) => a.path.localeCompare(b.path));
  res.json({ workspacePath: WORKSPACE_DIR, files });
});

// ---- Open workspace in OS file explorer ----
app.post('/api/workspace/open', (req, res) => {
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(cmd, [WORKSPACE_DIR], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (err) => {
    // explorer.exe frequently exits non-zero even on success; only real
    // spawn failures (missing binary) land here.
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
  child.unref();
  res.json({ opened: true });
});

// ---- Connect Claude Code to Fluid (registers + opens OAuth login) ----
const DEFAULT_FLUID_MCP_URL = process.env.FLUID_MCP_URL || 'http://localhost:4790/mcp';

app.post('/api/connect-claude', async (req, res) => {
  const { mcpUrl, configDir } = req.body || {};
  try {
    const addResult = await claudeConnect.addFluidServer(mcpUrl || DEFAULT_FLUID_MCP_URL, configDir);
    const alreadyExists = /already exists/i.test(addResult.stdout + addResult.stderr);
    if (addResult.code !== 0 && !alreadyExists) {
      return res.status(500).json({ error: `claude mcp add failed: ${(addResult.stderr || addResult.stdout).trim()}` });
    }
    claudeConnect.startLogin(configDir);
    res.json({ started: true, message: 'A new terminal window opened to complete sign-in - approve Fluid in the browser that opens from it.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/connect-claude/status', async (req, res) => {
  const { configDir } = req.query;
  try {
    const status = await claudeConnect.getStatus(configDir);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Fluid Local Agent Bridge listening on http://localhost:${PORT}`);
  console.log(`Workspace: ${WORKSPACE_DIR}`);
});
