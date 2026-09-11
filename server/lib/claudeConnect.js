'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectClaudeCode } = require('./agentDetect');

// PowerShell single-quoted string literal: backslash is NOT an escape
// character there (only a doubled single-quote is), unlike JSON.stringify -
// using JSON.stringify here doubled every backslash in Windows paths.
function psQuote(str) {
  return `'${String(str).replace(/'/g, "''")}'`;
}

function run(exe, args, opts) {
  return new Promise((resolve) => {
    execFile(exe, args, Object.assign({ timeout: 15000, windowsHide: true }, opts), (err, stdout, stderr) => {
      resolve({ code: err ? err.code || 1 : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/**
 * Registers Fluid as a remote MCP server for this Claude Code profile.
 * Safe to call repeatedly (claude mcp add is idempotent-ish: re-adding just
 * updates the existing entry).
 */
async function addFluidServer(mcpUrl, configDir) {
  const info = detectClaudeCode();
  if (!info.available) throw new Error(`Claude Code is not available: ${info.reason}`);
  const env = Object.assign({}, process.env);
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  const result = await run(info.path, ['mcp', 'add', '--transport', 'http', 'fluid', mcpUrl], { env });
  return result;
}

/**
 * Opens Claude Code's OAuth login for the "fluid" MCP server in a brand new,
 * real console window. This is necessary because `claude mcp login` refuses
 * to run without a genuine interactive terminal attached to stdin - it will
 * not proceed under a piped/headless child process. Spawning a fresh visible
 * console via `cmd /c start` gives it that real TTY, and the customer sees
 * exactly what's happening (a terminal opens, their browser opens to
 * approve Fluid, the terminal reports success) - closer to the real
 * onboarding experience than a silent background call would be anyway.
 */
function startLogin(configDir) {
  const info = detectClaudeCode();
  if (!info.available) throw new Error(`Claude Code is not available: ${info.reason}`);
  const env = Object.assign({}, process.env);
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;

  // `detached + stdio:'ignore'` alone gives the child NO console at all
  // (Windows DETACHED_PROCESS), which still fails `claude mcp login`'s TTY
  // check - just invisibly this time. PowerShell's Start-Process reliably
  // opens a genuine new console window with its own TTY (verified working).
  // The command is written to a .ps1 file on disk rather than passed inline
  // via -Command: an inline string goes through JS -> Node's argv quoting
  // for CreateProcess -> PowerShell's own tokenizer, and a Windows path's
  // backslashes do not survive that chain intact. Writing the file via
  // fs.writeFileSync avoids all of that - PowerShell then only has to
  // receive a single -File <path> argument.
  const scriptPath = path.join(os.tmpdir(), `fluid-connect-claude-${Date.now()}.ps1`);
  const psLines = [];
  if (configDir) psLines.push(`$env:CLAUDE_CONFIG_DIR = ${psQuote(configDir)}`);
  psLines.push(`Start-Process -FilePath ${psQuote(info.path)} -ArgumentList @('mcp','login','fluid')`);
  fs.writeFileSync(scriptPath, psLines.join('\n'), 'utf8');

  // NOTE: detached:true here (on the launcher, not the eventual claude
  // process) empirically breaks Start-Process's ability to open its own new
  // console - verified by isolated testing. The launcher itself returns in
  // well under a second (Start-Process doesn't wait), so leaving it attached
  // costs nothing.
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    stdio: 'ignore',
    windowsHide: false, // must stay visible - hiding this also hides the console Start-Process opens
    env,
  });
}

async function getStatus(configDir) {
  const info = detectClaudeCode();
  if (!info.available) return { available: false, reason: info.reason };
  const env = Object.assign({}, process.env);
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  const result = await run(info.path, ['mcp', 'get', 'fluid'], { env });
  if (result.code !== 0) {
    return { available: true, configured: false, connected: false, raw: (result.stdout + result.stderr).trim() };
  }
  const raw = result.stdout.trim();
  const connected = !/needs authentication/i.test(raw);
  return { available: true, configured: true, connected, raw };
}

module.exports = { addFluidServer, startLogin, getStatus };
