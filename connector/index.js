'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFile, execFileSync, spawn } = require('child_process');
const WebSocket = require('ws');
const { isSea } = require('node:sea');

const DEFAULT_SERVER = process.env.FLUID_CLOUD_URL || 'https://fluid-code-poc.onrender.com';
const APP_DIR = process.env.FLUID_CONNECTOR_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || os.homedir(), 'Fluid Connector');
const CONFIG_PATH = path.join(APP_DIR, 'config.json');
const INSTALLED_EXE = path.join(APP_DIR, 'FluidConnector.exe');
let socket;
let workspace = null;
let reconnectDelay = 1000;
let running = false;
let lastOpenedPairCode = null;

function randomId(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function runQuiet(exe, args) {
  try { return execFileSync(exe, args, { encoding:'utf8', timeout:10000, windowsHide:true }).trim(); }
  catch { return null; }
}
function openUrl(url) {
  if (process.env.FLUID_NO_BROWSER === '1') return;
  const child = spawn('explorer.exe', [url], { detached:true, stdio:'ignore', windowsHide:true });
  child.unref();
}

function installIfNeeded() {
  if (!isSea() || process.argv.includes('--installed') || path.resolve(process.execPath).toLowerCase() === path.resolve(INSTALLED_EXE).toLowerCase()) return false;
  fs.mkdirSync(APP_DIR, { recursive:true });
  fs.copyFileSync(process.execPath, INSTALLED_EXE);
  runQuiet('reg.exe', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'FluidConnector', '/t', 'REG_SZ', '/d', `"${INSTALLED_EXE}" --installed`, '/f']);
  runQuiet('reg.exe', ['add', 'HKCU\\Software\\Classes\\fluid', '/ve', '/d', 'URL:Fluid Connector', '/f']);
  runQuiet('reg.exe', ['add', 'HKCU\\Software\\Classes\\fluid', '/v', 'URL Protocol', '/d', '', '/f']);
  runQuiet('reg.exe', ['add', 'HKCU\\Software\\Classes\\fluid\\shell\\open\\command', '/ve', '/d', `"${INSTALLED_EXE}" --installed "%1"`, '/f']);
  const child = spawn(INSTALLED_EXE, ['--installed', '--first-run'], { detached:true, stdio:'ignore', windowsHide:true });
  child.unref();
  return true;
}

function loadConfig() {
  fs.mkdirSync(APP_DIR, { recursive:true });
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...saved, server:saved.server || DEFAULT_SERVER };
  } catch {
    const created = { deviceId:randomId(18), secret:randomId(32), server:DEFAULT_SERVER };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(created, null, 2));
    return created;
  }
}

function findOnPath(command) {
  const output = runQuiet('where.exe', [command]);
  return output && output.split(/\r?\n/).find(Boolean);
}
function findClaude() {
  const onPath = findOnPath('claude');
  if (onPath) return onPath.trim();
  const extensionRoot = path.join(os.homedir(), '.vscode', 'extensions');
  if (!fs.existsSync(extensionRoot)) return null;
  const candidates = fs.readdirSync(extensionRoot)
    .filter((name) => name.startsWith('anthropic.claude-code-'))
    .map((name) => path.join(extensionRoot, name, 'resources', 'native-binary', 'claude.exe'))
    .filter((candidate) => fs.existsSync(candidate))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric:true }));
  return candidates.at(-1) || null;
}
function agentInfo() {
  const executable = findClaude();
  const version = executable ? runQuiet(executable, ['--version']) : null;
  let authenticated = false;
  if (executable && version) {
    try {
      authenticated = !!JSON.parse(runQuiet(executable, ['auth', 'status', '--json']) || '{}').loggedIn;
    } catch {}
  }
  return { executable, public:{ claude:{ available:!!version, authenticated, version:version ? version.split(/\r?\n/)[0] : null } } };
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
function chooseWorkspace() {
  const script = "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Choose the workspace Fluid may edit'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.SelectedPath)}";
  execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding:'utf8', windowsHide:true }, (error, stdout) => {
    if (!error && stdout.trim()) workspace = stdout.trim();
    send({ type:'workspace', path:workspace });
  });
}

function describeClaudeEvent(event) {
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    return event.message.content.map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'tool_use') return `Using ${block.name}`;
      return '';
    }).filter(Boolean).join(' ');
  }
  if (event.type === 'result') return event.result || (event.is_error ? 'Claude Code reported an error.' : 'Completed.');
  return null;
}

function runClaude(prompt) {
  if (running) return send({ type:'run_state', status:'error', message:'An agent is already running.' });
  if (!workspace) return send({ type:'run_state', status:'error', message:'Select a workspace first.' });
  const detected = agentInfo();
  if (!detected.executable) return send({ type:'run_state', status:'error', message:'Claude Code is not installed or could not be detected.' });
  running = true;
  send({ type:'run_state', status:'running', message:'Claude Code started.' });
  const child = spawn(detected.executable, ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', String(prompt || '')], { cwd:workspace, windowsHide:true });
  const lines = readline.createInterface({ input:child.stdout });
  lines.on('line', (line) => {
    try {
      const message = describeClaudeEvent(JSON.parse(line));
      if (message) send({ type:'activity', message:String(message).slice(0, 500) });
    } catch {}
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (error) => {
    running = false;
    send({ type:'run_state', status:'error', message:error.message });
  });
  child.on('close', (code) => {
    running = false;
    send({ type:'run_state', status:code === 0 ? 'completed' : 'error', message:code === 0 ? 'Claude Code completed.' : `Claude Code exited with code ${code}: ${stderr.slice(0, 300)}` });
  });
}

function loginClaude() {
  const detected = agentInfo();
  if (!detected.executable) return send({ type:'activity', level:'error', message:'Claude Code is not installed.' });
  send({ type:'activity', message:'Opening Claude sign-in in your browser.' });
  const child = spawn(detected.executable, ['auth', 'login'], { windowsHide:true, stdio:'ignore' });
  child.on('error', (error) => send({ type:'activity', level:'error', message:`Could not start Claude sign-in: ${error.message}` }));
  child.on('close', () => {
    const updated = agentInfo();
    send({ type:'hello', name:os.hostname(), agents:updated.public });
    send({ type:'activity', level:updated.public.claude.authenticated ? 'log' : 'error', message:updated.public.claude.authenticated ? 'Claude Code sign-in completed.' : 'Claude Code is still not signed in.' });
  });
}

function connect(config) {
  const wsBase = config.server.replace(/^http/, 'ws').replace(/\/$/, '');
  socket = new WebSocket(`${wsBase}/connector?deviceId=${encodeURIComponent(config.deviceId)}&secret=${encodeURIComponent(config.secret)}`);
  socket.on('open', () => {
    reconnectDelay = 1000;
    send({ type:'hello', name:os.hostname(), agents:agentInfo().public });
    if (workspace) send({ type:'workspace', path:workspace });
  });
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'welcome' && message.pairingCode && message.pairingCode !== lastOpenedPairCode) {
      lastOpenedPairCode = message.pairingCode;
      openUrl(`${config.server.replace(/\/$/, '')}/dashboard/?pair=${encodeURIComponent(message.pairingCode)}`);
    }
    if (message.type === 'command' && message.action === 'select_workspace') chooseWorkspace();
    if (message.type === 'command' && message.action === 'login_claude') loginClaude();
    if (message.type === 'command' && message.action === 'run') runClaude(message.prompt);
  });
  socket.on('close', () => {
    setTimeout(() => connect(config), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });
  socket.on('error', () => {});
}

if (!installIfNeeded()) connect(loadConfig());
