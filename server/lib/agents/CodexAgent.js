'use strict';

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const CodingAgent = require('./CodingAgent');
const { detectCodex } = require('../agentDetect');

/**
 * Drives the official Codex CLI in non-interactive "exec" mode:
 *   codex exec --json -s workspace-write -C <projectPath> --skip-git-repo-check "<prompt>"
 * using whatever local Codex login (ChatGPT auth or API key already
 * configured by the customer) is already present on this machine.
 */
class CodexAgent extends CodingAgent {
  constructor() {
    super({ id: 'codex', name: 'Codex' });
  }

  async detect() {
    return detectCodex();
  }

  async start(projectPath, prompt, onEvent) {
    const info = await this.detect();
    if (!info.available) {
      throw new Error(`Codex is not available: ${info.reason}`);
    }

    onEvent({ type: 'log', message: 'Agent started (Codex)' });
    onEvent({ type: 'log', message: `Working directory: ${projectPath}` });

    return new Promise((resolve, reject) => {
      const child = spawn(info.path, [
        'exec',
        '--json',
        '-s', 'workspace-write',
        '-C', projectPath,
        '--skip-git-repo-check',
        prompt,
      ], { cwd: projectPath, windowsHide: true });

      const rl = readline.createInterface({ input: child.stdout });
      let sawTurnCompleted = false;
      let lastAgentMessage = '';
      let stderr = '';

      rl.on('line', (line) => {
        if (!line.trim()) return;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch (e) {
          return;
        }
        if (evt.type === 'turn.completed') sawTurnCompleted = true;
        const msg = this._handleEvent(evt, onEvent);
        if (msg) lastAgentMessage = msg;
      });

      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        onEvent({ type: 'error', message: `Failed to start Codex: ${err.message}` });
        reject(err);
      });

      child.on('close', (code) => {
        if (code !== 0 && !sawTurnCompleted) {
          const detail = stderr.trim().slice(0, 500);
          onEvent({ type: 'error', message: `Codex exited with code ${code}${detail ? `: ${detail}` : ''}` });
          reject(new Error(`codex exited with code ${code}`));
          return;
        }
        onEvent({ type: 'log', message: 'Agent completed' });
        resolve({ success: true, summary: lastAgentMessage || 'Completed' });
      });
    });
  }

  _handleEvent(evt, onEvent) {
    if (evt.type === 'item.started' && evt.item && evt.item.type === 'file_change') {
      for (const c of evt.item.changes || []) {
        const verb = c.kind === 'add' ? 'Creating' : 'Updating';
        onEvent({ type: 'log', message: `${verb} ${path.basename(c.path)}` });
      }
    } else if (evt.type === 'item.started' && evt.item && evt.item.type === 'command_execution') {
      onEvent({ type: 'log', message: `Running: ${evt.item.command}` });
    } else if (evt.type === 'item.completed' && evt.item && evt.item.type === 'command_execution') {
      if (evt.item.exit_code !== 0) {
        onEvent({ type: 'error', message: `Command failed (exit ${evt.item.exit_code}): ${evt.item.command}` });
      }
    } else if (evt.type === 'item.completed' && evt.item && evt.item.type === 'agent_message') {
      const text = (evt.item.text || '').trim();
      if (text) {
        onEvent({ type: 'log', message: text.slice(0, 300) });
        return text;
      }
    } else if (evt.type === 'turn.failed') {
      onEvent({ type: 'error', message: `Turn failed: ${(evt.error && evt.error.message) || 'unknown error'}` });
    }
    return null;
  }
}

module.exports = CodexAgent;
