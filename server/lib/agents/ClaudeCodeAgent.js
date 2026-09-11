'use strict';

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const CodingAgent = require('./CodingAgent');
const { detectClaudeCode } = require('../agentDetect');

/**
 * Drives the official Claude Code CLI in non-interactive "print" mode:
 *   claude -p --output-format stream-json --permission-mode acceptEdits "<prompt>"
 * run with cwd = the project workspace, using whatever local Claude Code
 * login/subscription is already configured on this machine.
 */
class ClaudeCodeAgent extends CodingAgent {
  constructor() {
    super({ id: 'claude-code', name: 'Claude Code' });
  }

  async detect() {
    return detectClaudeCode();
  }

  async start(projectPath, prompt, onEvent) {
    const info = await this.detect();
    if (!info.available) {
      throw new Error(`Claude Code is not available: ${info.reason}`);
    }

    onEvent({ type: 'log', message: 'Agent started (Claude Code)' });
    onEvent({ type: 'log', message: `Working directory: ${projectPath}` });

    return new Promise((resolve, reject) => {
      const child = spawn(info.path, [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'acceptEdits',
        prompt,
      ], { cwd: projectPath, windowsHide: true });

      const rl = readline.createInterface({ input: child.stdout });
      let finalResult = null;
      let stderr = '';

      rl.on('line', (line) => {
        if (!line.trim()) return;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch (e) {
          return;
        }
        this._handleEvent(evt, onEvent);
        if (evt.type === 'result') finalResult = evt;
      });

      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        onEvent({ type: 'error', message: `Failed to start Claude Code: ${err.message}` });
        reject(err);
      });

      child.on('close', (code) => {
        if (code !== 0 && !finalResult) {
          const detail = stderr.trim().slice(0, 500);
          onEvent({ type: 'error', message: `Claude Code exited with code ${code}${detail ? `: ${detail}` : ''}` });
          reject(new Error(`claude exited with code ${code}`));
          return;
        }
        onEvent({ type: 'log', message: 'Agent completed' });
        resolve({
          success: !finalResult || !finalResult.is_error,
          summary: (finalResult && finalResult.result) || 'Completed',
        });
      });
    });
  }

  _handleEvent(evt, onEvent) {
    if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
      for (const block of evt.message.content) {
        if (block.type === 'tool_use') {
          onEvent({ type: 'log', message: this._describeTool(block) });
        } else if (block.type === 'text' && block.text && block.text.trim()) {
          onEvent({ type: 'log', message: block.text.trim().slice(0, 300) });
        }
      }
    } else if (evt.type === 'result') {
      if (evt.is_error) {
        onEvent({ type: 'error', message: `Agent reported an error: ${evt.result || 'unknown error'}` });
      }
    }
  }

  _describeTool(block) {
    const input = block.input || {};
    switch (block.name) {
      case 'Write':
        return `Creating ${path.basename(input.file_path || '')}`;
      case 'Edit':
        return `Editing ${path.basename(input.file_path || '')}`;
      case 'Bash':
        return `Running: ${input.command || ''}`;
      default:
        return `Using tool: ${block.name}`;
    }
  }
}

module.exports = ClaudeCodeAgent;
