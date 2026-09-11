'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { oauthProvider } = require('./lib/oauthProvider');
const { createFluidMcpServer } = require('./lib/mcpServer');
const store = require('./lib/store');
const deviceBroker = require('./lib/deviceBroker');

const PORT = process.env.PORT || 4790;
const BASE_URL = process.env.FLUID_BASE_URL || `http://localhost:${PORT}`;
const baseUrl = new URL(BASE_URL);
const mcpUrl = new URL('/mcp', baseUrl);

const app = express();
const httpServer = http.createServer(app);

// ---- OAuth 2.1 authorization server + protected-resource metadata ----
// This is the piece that lets `claude mcp add --transport http fluid <url>`
// followed by `claude mcp login fluid` complete a real OAuth handshake:
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

// ---- Fluid Connector: pairing, status, and command relay ----
// The connector always initiates the connection outbound, so customers do
// not need to expose a local port or change firewall/router settings.
const CONNECTOR_DOWNLOAD_URL = process.env.CONNECTOR_DOWNLOAD_URL
  || 'https://github.com/rumman-acc/fluid-code-poc/releases/download/connector-latest/FluidConnectorSetup.exe';

function connectorAuth(req, res) {
  const device = deviceBroker.authorized(req.params.deviceId, req.get('x-fluid-device-token'));
  if (!device) res.status(401).json({ error: 'This browser is not paired with that computer.' });
  return device;
}

app.get('/api/connector/config', (req, res) => {
  res.json({ downloadUrl: CONNECTOR_DOWNLOAD_URL, platform: 'windows' });
});

app.post('/api/connector/claim', (req, res) => {
  const result = deviceBroker.claim(String((req.body || {}).pairingCode || ''));
  if (!result) return res.status(404).json({ error: 'Pairing link is invalid or expired. Restart Fluid Connector to try again.' });
  res.json(result);
});

app.get('/api/connector/devices/:deviceId', (req, res) => {
  const device = connectorAuth(req, res);
  if (!device) return;
  res.json({ device: deviceBroker.publicDevice(device), activity: device.events });
});

app.post('/api/connector/devices/:deviceId/commands', (req, res) => {
  const device = connectorAuth(req, res);
  if (!device) return;
  const { action, prompt, agentId } = req.body || {};
  if (!['select_workspace', 'login_claude', 'run'].includes(action)) return res.status(400).json({ error: 'Unsupported command.' });
  if (action === 'run' && (!prompt || !String(prompt).trim())) return res.status(400).json({ error: 'Prompt is required.' });
  const commandPayload = action === 'run'
    ? {
        agentId,
        prompt: `Fluid project requirements:\n\n${store.getProject().requirements}\n\nUser instruction:\n${prompt}`,
      }
    : {};
  if (!deviceBroker.send(device, action, commandPayload)) return res.status(409).json({ error: 'Computer is offline.' });
  res.json({ accepted: true });
});

app.get('/', (req, res) => res.redirect('/dashboard/'));

const connectorWss = new WebSocketServer({ noServer: true });
const heartbeat = setInterval(() => {
  for (const ws of connectorWss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
connectorWss.on('close', () => clearInterval(heartbeat));
httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, BASE_URL);
  if (url.pathname !== '/connector') {
    socket.destroy();
    return;
  }
  connectorWss.handleUpgrade(req, socket, head, (ws) => {
    deviceBroker.attach(ws, url.searchParams.get('deviceId'), url.searchParams.get('secret'));
  });
});

httpServer.listen(PORT, () => {
  console.log(`Fluid MCP Server + project dashboard listening on ${BASE_URL}`);
  console.log(`MCP endpoint:      ${mcpUrl.toString()}`);
  console.log(`Dashboard:         ${BASE_URL}/dashboard/`);
  console.log(`AS metadata:       ${BASE_URL}/.well-known/oauth-authorization-server`);
});
