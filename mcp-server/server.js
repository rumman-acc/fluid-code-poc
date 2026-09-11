'use strict';

const express = require('express');
const path = require('path');

const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { oauthProvider } = require('./lib/oauthProvider');
const { createFluidMcpServer } = require('./lib/mcpServer');
const store = require('./lib/store');

const PORT = process.env.PORT || 4790;
const BASE_URL = process.env.FLUID_BASE_URL || `http://localhost:${PORT}`;
const baseUrl = new URL(BASE_URL);
const mcpUrl = new URL('/mcp', baseUrl);

const app = express();

// ---- OAuth 2.1 authorization server + protected-resource metadata ----
// This lets Claude Code's bundled Fluid plugin complete a real OAuth handshake:
// dynamic client registration, PKCE authorization code grant, bearer tokens.
app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: baseUrl,
    resourceServerUrl: mcpUrl,
    scopesSupported: ['fluid:mcp'],
    resourceName: 'Fluid',
  })
);

// ---- MCP endpoint (protected: requires the bearer token issued above) ----
const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpUrl);
const bearerAuth = requireBearerAuth({ verifier: oauthProvider, resourceMetadataUrl });

app.post('/mcp', express.json(), bearerAuth, async (req, res) => {
  const server = createFluidMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', bearerAuth, async (req, res) => {
  res.status(405).json({ error: 'Method not allowed (stateless server: use POST)' });
});

// ---- Fluid SaaS project dashboard (human-facing, separate from the agent-facing /mcp endpoint) ----
app.use(express.json());
app.use('/dashboard', express.static(path.join(__dirname, 'web')));

app.get('/api/project', (req, res) => {
  res.json({ project: store.getProject(), mcpUrl: mcpUrl.toString() });
});

app.post('/api/project/requirements', (req, res) => {
  const { requirements } = req.body || {};
  if (typeof requirements !== 'string' || !requirements.trim()) {
    return res.status(400).json({ error: 'requirements text is required' });
  }
  store.setRequirements(requirements);
  res.json({ ok: true });
});

app.get('/api/activity', (req, res) => {
  res.json({ activity: store.getActivity() });
});

app.get('/api/activity/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders && res.flushHeaders();

  for (const entry of store.getActivity()) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  const onActivity = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
  store.bus.on('activity', onActivity);
  req.on('close', () => store.bus.off('activity', onActivity));
});

// ---- Browser-to-Claude pairing ----
// Claude calls connect_fluid through MCP with the one-time code. The browser
// only receives an opaque token it can use to poll its own connection status.
app.post('/api/claude/pairings', (req, res) => {
  res.status(201).json(store.createClaudePairing());
});

app.get('/api/claude/pairings/:browserToken', (req, res) => {
  const status = store.getClaudePairingStatus(req.params.browserToken);
  if (!status) return res.status(404).json({ error: 'Pairing session not found or expired.' });
  res.json(status);
});

app.get('/', (req, res) => res.redirect('/dashboard/'));

app.listen(PORT, () => {
  console.log(`Fluid MCP Server + project dashboard listening on ${BASE_URL}`);
  console.log(`MCP endpoint:      ${mcpUrl.toString()}`);
  console.log(`Dashboard:         ${BASE_URL}/dashboard/`);
  console.log(`AS metadata:       ${BASE_URL}/.well-known/oauth-authorization-server`);
});
