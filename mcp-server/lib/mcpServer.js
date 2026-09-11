'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const store = require('./store');

/**
 * Builds a fresh McpServer instance exposing Fluid's tools. A new instance
 * is created per request in stateless HTTP mode (matches the SDK's
 * recommended pattern for StreamableHTTPServerTransport with
 * sessionIdGenerator: undefined).
 */
function createFluidMcpServer() {
  const server = new McpServer({ name: 'fluid', version: '0.1.0' });

  server.registerTool(
    'connect_fluid',
    {
      title: 'Connect Claude Code to Fluid',
      description:
        'Pair this Claude Code session with the Fluid browser session using the one-time code shown by Fluid.',
      inputSchema: {
        pairing_code: z.string().describe('The one-time pairing code shown in the Fluid website'),
      },
    },
    async ({ pairing_code }) => {
      const result = store.connectClaude(pairing_code);
      if (!result) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'That Fluid pairing code is invalid or expired. Create a new connection from the Fluid website.' }],
        };
      }
      return {
        content: [{ type: 'text', text: `Claude Code is connected to Fluid for project "${result.project}".` }],
      };
    }
  );

  server.registerTool(
    'get_project_requirements',
    {
      title: 'Get Fluid project requirements',
      description:
        "Fetch the current project's requirements/spec from Fluid, as defined by the customer's team - use this instead of asking the user to restate the spec.",
      inputSchema: {},
    },
    async () => {
      const project = store.getProject();
      store.addActivity({ type: 'tool_call', tool: 'get_project_requirements', message: `Fetched requirements for "${project.name}"` });
      return {
        content: [
          {
            type: 'text',
            text: `Project: ${project.name}\n\n${project.requirements}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    'report_agent_activity',
    {
      title: 'Report agent activity to Fluid',
      description:
        'Report a short, specific progress update back to Fluid so it can show real-time status and keep an audit trail of what the agent did. Call this as you make meaningful progress (creating a file, finishing a feature, running validation).',
      inputSchema: {
        message: z.string().describe('Short, specific progress update, e.g. "Created index.html with the item list layout"'),
      },
    },
    async ({ message }) => {
      store.addActivity({ type: 'agent_report', tool: 'report_agent_activity', message });
      return { content: [{ type: 'text', text: 'Reported to Fluid.' }] };
    }
  );

  return server;
}

module.exports = { createFluidMcpServer };
