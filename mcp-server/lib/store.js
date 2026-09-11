'use strict';

const { EventEmitter } = require('events');

/**
 * In-memory "Fluid tenant" state for this POC: one project, its
 * requirements, and the activity log agents report back via MCP.
 * A real Fluid backend would back this with a real database, per-customer
 * tenancy, and persistence - this POC keeps it in memory to stay small.
 */
const bus = new EventEmitter();

const project = {
  id: 'default',
  name: 'Inventory Management',
  requirements: `Build a simple Inventory Management web application.

Requirements:
1. Create index.html, styles.css and app.js in the current workspace.
2. Show a list of inventory items: SKU, name, quantity on hand, reorder threshold.
3. Highlight items at or below their reorder threshold.
4. Allow adding a new item via a small form.
5. Allow adjusting quantity (+/- buttons) on each item.
6. Show a summary: total items, items low on stock.
7. No backend or external API - plain HTML/CSS/JS, in-memory state is fine.
8. As you work, call the report_agent_activity tool with short, specific updates
   (e.g. "Creating index.html", "Wiring up quantity adjustment") so Fluid can show
   real-time progress and keep an audit trail.`,
};

const activity = [];

function getProject() {
  return project;
}

function setRequirements(text) {
  project.requirements = text;
}

function addActivity(entry) {
  const withMeta = Object.assign({ ts: new Date().toISOString() }, entry);
  activity.push(withMeta);
  bus.emit('activity', withMeta);
  return withMeta;
}

function getActivity() {
  return activity;
}

module.exports = { bus, getProject, setRequirements, addActivity, getActivity };
