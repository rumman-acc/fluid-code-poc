(() => {
  const el = (id) => document.getElementById(id);

  const projectNameInput = el('projectName');
  const workspacePathInput = el('workspacePath');
  const agentChoices = el('agentChoices');
  const promptInput = el('prompt');
  const startBtn = el('startBtn');
  const startError = el('startError');
  const activityLog = el('activityLog');
  const fileList = el('fileList');
  const openWorkspaceBtn = el('openWorkspaceBtn');
  const runAppBtn = el('runAppBtn');
  const connectClaudeBtn = el('connectClaudeBtn');
  const connectClaudeBadge = el('connectClaudeBadge');
  const connectClaudeDetail = el('connectClaudeDetail');

  let connectPollTimer = null;

  async function refreshConnectClaudeStatus() {
    try {
      const res = await fetch('/api/connect-claude/status');
      const data = await res.json();
      if (!data.available) {
        connectClaudeBadge.textContent = 'Unavailable';
        connectClaudeBadge.className = 'badge bad';
        connectClaudeDetail.textContent = data.reason || 'Claude Code not found';
        connectClaudeBtn.disabled = true;
        return data;
      }
      if (data.connected) {
        connectClaudeBadge.textContent = 'Connected';
        connectClaudeBadge.className = 'badge ok';
        connectClaudeDetail.textContent = 'Claude Code is authenticated to the Fluid MCP Server.';
      } else if (data.configured) {
        connectClaudeBadge.textContent = 'Needs sign-in';
        connectClaudeBadge.className = 'badge bad';
        connectClaudeDetail.textContent = 'Registered, but not yet authenticated.';
      } else {
        connectClaudeBadge.textContent = 'Not connected';
        connectClaudeBadge.className = 'badge bad';
        connectClaudeDetail.textContent = 'Click Connect to link this machine\'s Claude Code to Fluid.';
      }
      return data;
    } catch (err) {
      connectClaudeDetail.textContent = 'Could not reach the Fluid bridge.';
      return null;
    }
  }

  function pollConnectClaudeUntilConnected() {
    if (connectPollTimer) clearInterval(connectPollTimer);
    let attempts = 0;
    connectPollTimer = setInterval(async () => {
      attempts += 1;
      const data = await refreshConnectClaudeStatus();
      if ((data && data.connected) || attempts > 30) {
        clearInterval(connectPollTimer);
        connectPollTimer = null;
        connectClaudeBtn.disabled = false;
      }
    }, 2000);
  }

  connectClaudeBtn.addEventListener('click', async () => {
    connectClaudeBtn.disabled = true;
    connectClaudeDetail.textContent = 'Opening a terminal to sign in… approve Fluid in the browser that opens.';
    try {
      const res = await fetch('/api/connect-claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start connect flow');
      pollConnectClaudeUntilConnected();
    } catch (err) {
      connectClaudeDetail.textContent = err.message;
      connectClaudeBtn.disabled = false;
    }
  });

  let selectedAgentId = null;
  let eventSource = null;

  function fmtTime(iso) {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString('en-US', { hour12: false });
  }

  function appendActivity(evt) {
    if (activityLog.querySelector('.activity-empty')) activityLog.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'activity-line' + (evt.type === 'error' ? ' error' : '');
    line.innerHTML = `<span class="time">${fmtTime(evt.ts)}</span><span class="msg"></span>`;
    line.querySelector('.msg').textContent = evt.message;
    activityLog.appendChild(line);
    activityLog.scrollTop = activityLog.scrollHeight;
  }

  function renderAgentChoices(agents) {
    agentChoices.innerHTML = '';
    const order = [
      ['codex', agents.codex],
      ['claude-code', agents['claude-code']],
    ];
    let firstAvailable = null;
    for (const [id, info] of order) {
      const label = document.createElement('label');
      label.className = 'agent-option' + (info.available ? '' : ' disabled');

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'agent';
      radio.value = id;
      radio.disabled = !info.available;
      radio.addEventListener('change', () => {
        selectedAgentId = id;
        startError.hidden = true;
      });

      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = id === 'codex' ? 'Codex' : 'Claude Code';
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = info.available
        ? `v${info.version} · ${info.source}`
        : info.reason;
      meta.appendChild(name);
      meta.appendChild(detail);

      const badge = document.createElement('span');
      badge.className = 'badge ' + (info.available ? 'ok' : 'bad');
      badge.textContent = info.available ? 'Available' : 'Unavailable';

      label.appendChild(radio);
      label.appendChild(meta);
      label.appendChild(badge);
      agentChoices.appendChild(label);

      if (info.available && !firstAvailable) firstAvailable = id;
    }

    if (firstAvailable) {
      const radio = agentChoices.querySelector(`input[value="${firstAvailable}"]`);
      radio.checked = true;
      selectedAgentId = firstAvailable;
    }
  }

  async function loadInit() {
    const res = await fetch('/api/init');
    const data = await res.json();
    workspacePathInput.value = data.workspacePath;
    projectNameInput.value = data.defaultProjectName;
    promptInput.value = data.defaultPrompt;
    renderAgentChoices(data.agents);
    await refreshFiles();
    await refreshConnectClaudeStatus();
  }

  async function refreshFiles() {
    const res = await fetch('/api/workspace/files');
    const data = await res.json();
    if (!data.files.length) {
      fileList.innerHTML = '<li class="file-empty">No files generated yet.</li>';
      runAppBtn.disabled = true;
      return;
    }
    fileList.innerHTML = '';
    let hasIndex = false;
    for (const f of data.files) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="check">✓</span><span></span>`;
      li.querySelector('span:last-child').textContent = f.path;
      fileList.appendChild(li);
      if (f.path.toLowerCase() === 'index.html') hasIndex = true;
    }
    runAppBtn.disabled = !hasIndex;
  }

  function connectStream(runId) {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/agent/events?runId=${encodeURIComponent(runId)}`);

    eventSource.addEventListener('activity', (e) => {
      appendActivity(JSON.parse(e.data));
    });

    eventSource.addEventListener('done', async (e) => {
      const data = JSON.parse(e.data);
      appendActivity({
        type: data.status === 'error' ? 'error' : 'log',
        message: data.error ? `Run failed: ${data.error}` : `Run finished: ${data.result?.summary || ''}`,
        ts: new Date().toISOString(),
      });
      eventSource.close();
      eventSource = null;
      startBtn.disabled = false;
      await refreshFiles();
    });

    eventSource.onerror = () => {
      // Connection issue mid-stream; leave the log as-is, re-enable the button
      // so the user isn't stuck if the server hiccups.
      startBtn.disabled = false;
    };
  }

  async function startAgent() {
    startError.hidden = true;
    if (!selectedAgentId) {
      startError.textContent = 'Select a coding agent first.';
      startError.hidden = false;
      return;
    }
    startBtn.disabled = true;
    activityLog.innerHTML = '';

    try {
      const res = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgentId,
          prompt: promptInput.value,
          projectName: projectNameInput.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start agent');
      connectStream(data.runId);
    } catch (err) {
      startError.textContent = err.message;
      startError.hidden = false;
      startBtn.disabled = false;
    }
  }

  async function openWorkspace() {
    try {
      await fetch('/api/workspace/open', { method: 'POST' });
    } catch (err) {
      // best-effort; nothing to show if the OS file explorer can't launch
    }
  }

  function runApplication() {
    window.open(`${location.origin}/app/index.html`, '_blank');
  }

  startBtn.addEventListener('click', startAgent);
  openWorkspaceBtn.addEventListener('click', openWorkspace);
  runAppBtn.addEventListener('click', runApplication);

  loadInit();
})();
