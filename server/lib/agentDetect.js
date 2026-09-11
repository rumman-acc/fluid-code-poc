'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Locates locally-authenticated coding agent CLIs on this machine.
 *
 * Fluid never installs, downloads, or fakes an agent. It only looks for
 * an *already installed* CLI the customer authenticated themselves:
 *   1. A `claude` / `codex` binary on PATH (the standalone CLI install), or
 *   2. The CLI binary bundled inside the customer's own VS Code extension
 *      (Anthropic's "Claude Code" extension / OpenAI's "ChatGPT" extension),
 *      which is how this machine has them installed.
 * Either way, the binary is invoked with the customer's own local
 * credentials (already-authenticated subscription) - Fluid never asks for
 * or stores an API key.
 */

function tryVersion(exe, args) {
  try {
    const out = execFileSync(exe, args, { encoding: 'utf8', timeout: 10000, windowsHide: true });
    return out.trim().split(/\r?\n/)[0].trim();
  } catch (e) {
    return null;
  }
}

function findOnPath(cmd) {
  try {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(finder, [cmd], { encoding: 'utf8', windowsHide: true });
    const first = out.split(/\r?\n/).find(Boolean);
    return first ? first.trim() : null;
  } catch (e) {
    return null;
  }
}

/**
 * Searches installed VS Code (and VS Code Insiders) extensions for a
 * bundled agent binary, e.g.
 *   ~/.vscode/extensions/anthropic.claude-code-2.1.266-win32-x64/resources/native-binary/claude.exe
 * Picks the highest-versioned extension directory if more than one exists.
 */
function findVSCodeBundled({ prefix, relBinary }) {
  const roots = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), '.vscode-insiders', 'extensions'),
  ];
  const candidates = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let dirs;
    try {
      dirs = fs.readdirSync(root).filter((d) => d.startsWith(prefix));
    } catch (e) {
      continue;
    }
    for (const d of dirs) {
      const full = path.join(root, d, relBinary);
      if (fs.existsSync(full)) candidates.push({ dir: d, full });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.dir.localeCompare(b.dir, undefined, { numeric: true }));
  return candidates[candidates.length - 1].full;
}

function detectClaudeCode() {
  const onPath = findOnPath('claude');
  if (onPath) {
    const version = tryVersion(onPath, ['--version']);
    if (version) return { available: true, path: onPath, version, source: 'PATH (claude CLI)' };
  }

  const relBinary = process.platform === 'win32'
    ? path.join('resources', 'native-binary', 'claude.exe')
    : path.join('resources', 'native-binary', 'claude');
  const bundled = findVSCodeBundled({ prefix: 'anthropic.claude-code-', relBinary });
  if (bundled) {
    const version = tryVersion(bundled, ['--version']);
    if (version) {
      return { available: true, path: bundled, version, source: 'VS Code extension (anthropic.claude-code)' };
    }
  }

  return {
    available: false,
    reason: 'No authenticated Claude Code CLI was found (checked PATH and the VS Code "Claude Code" extension). Install Claude Code and sign in: https://docs.claude.com/claude-code',
  };
}

function detectCodex() {
  const onPath = findOnPath('codex');
  if (onPath) {
    const version = tryVersion(onPath, ['--version']);
    if (version) return { available: true, path: onPath, version, source: 'PATH (codex CLI)' };
  }

  let platDir;
  if (process.platform === 'win32') platDir = 'windows-x86_64';
  else if (process.platform === 'darwin') platDir = os.arch() === 'arm64' ? 'darwin-arm64' : 'darwin-x86_64';
  else platDir = 'linux-x86_64';
  const relBinary = path.join('bin', platDir, process.platform === 'win32' ? 'codex.exe' : 'codex');
  const bundled = findVSCodeBundled({ prefix: 'openai.chatgpt-', relBinary });
  if (bundled) {
    const version = tryVersion(bundled, ['--version']);
    if (version) {
      return { available: true, path: bundled, version, source: 'VS Code extension (openai.chatgpt)' };
    }
  }

  return {
    available: false,
    reason: 'No authenticated Codex CLI was found (checked PATH and the VS Code "ChatGPT" extension). Install Codex and run "codex login": https://developers.openai.com/codex/cli',
  };
}

module.exports = { detectClaudeCode, detectCodex };
