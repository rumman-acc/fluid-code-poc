'use strict';

const { EventEmitter } = require('events');

/**
 * Tracks the single in-flight (or most recent) agent run and fans out its
 * activity events to any connected SSE clients. This POC supports one
 * active run at a time, matching the "Start Agent" -> single workspace flow.
 */
class RunManager extends EventEmitter {
  constructor() {
    super();
    this.current = null;
  }

  isBusy() {
    return !!this.current && this.current.status === 'running';
  }

  createRun(agentId, prompt) {
    const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.current = {
      id,
      agentId,
      prompt,
      status: 'running',
      events: [],
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    };
    return this.current;
  }

  pushEvent(runId, event) {
    if (!this.current || this.current.id !== runId) return;
    const withTs = Object.assign({ ts: new Date().toISOString() }, event);
    this.current.events.push(withTs);
    this.emit(`event:${runId}`, withTs);
  }

  finish(runId, { success, summary, error }) {
    if (!this.current || this.current.id !== runId) return;
    this.current.status = error ? 'error' : 'completed';
    this.current.finishedAt = new Date().toISOString();
    this.current.result = { success, summary };
    this.current.error = error ? String((error && error.message) || error) : null;
    this.emit(`done:${runId}`, this.current);
  }

  getRun(runId) {
    if (this.current && this.current.id === runId) return this.current;
    return null;
  }
}

module.exports = new RunManager();
