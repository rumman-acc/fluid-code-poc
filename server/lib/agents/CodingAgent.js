'use strict';

/**
 * Abstraction over a locally-installed, locally-authenticated coding agent
 * CLI. Fluid's bridge talks to concrete subclasses only - it never talks to
 * a model API directly.
 */
class CodingAgent {
  constructor({ id, name }) {
    this.id = id;
    this.name = name;
  }

  /** @returns {Promise<{available:boolean, version?:string, path?:string, source?:string, reason?:string}>} */
  async detect() {
    throw new Error('detect() not implemented');
  }

  /**
   * Runs the agent against a local project directory.
   * @param {string} projectPath absolute path the agent's cwd/working root must be set to
   * @param {string} prompt instructions for the agent
   * @param {(event:{type:string,message:string})=>void} onEvent called for each activity line
   * @returns {Promise<{success:boolean, summary:string}>}
   */
  async start(projectPath, prompt, onEvent) {
    throw new Error('start() not implemented');
  }
}

module.exports = CodingAgent;
