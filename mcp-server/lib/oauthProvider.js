'use strict';

const crypto = require('crypto');

/**
 * Minimal Fluid OAuth 2.1 authorization server, implementing the SDK's
 * OAuthServerProvider interface so Claude Code's built-in `claude mcp add`
 * + `claude mcp login` flow (dynamic client registration, PKCE authorization
 * code grant) works against this server exactly as it would against any
 * other remote MCP server.
 *
 * POC simplification, stated plainly: there is no real Fluid customer/login
 * database here, so /authorize auto-approves as a single fixed "customer"
 * identity instead of showing a real login/consent screen. Everything else
 * (dynamic client registration, PKCE, authorization codes, bearer tokens,
 * token verification gating tool calls) is the real OAuth mechanics a
 * production Fluid authorization server would also implement.
 */

const clients = new Map(); // client_id -> OAuthClientInformationFull
const authCodes = new Map(); // code -> { clientId, codeChallenge, redirectUri, resource, expiresAt }
const accessTokens = new Map(); // token -> { clientId, customerId, expiresAt }

const TOKEN_TTL_SECONDS = 60 * 60 * 8; // 8 hours - plenty for a POC session

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

const clientsStore = {
  getClient(clientId) {
    return clients.get(clientId);
  },
  registerClient(clientMetadata) {
    const client_id = randomToken(16);
    const full = Object.assign({}, clientMetadata, {
      client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    });
    clients.set(client_id, full);
    return full;
  },
};

const oauthProvider = {
  clientsStore,

  async authorize(client, params, res) {
    // POC simplification: auto-approve as the single demo customer instead
    // of rendering a real login/consent UI. See file header.
    const code = randomToken(24);
    authCodes.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      resource: params.resource ? params.resource.toString() : undefined,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set('code', code);
    if (params.state) redirect.searchParams.set('state', params.state);
    res.redirect(302, redirect.toString());
  },

  async challengeForAuthorizationCode(client, authorizationCode) {
    const entry = authCodes.get(authorizationCode);
    if (!entry || entry.clientId !== client.client_id) {
      throw new Error('Invalid authorization code');
    }
    return entry.codeChallenge;
  },

  async exchangeAuthorizationCode(client, authorizationCode) {
    const entry = authCodes.get(authorizationCode);
    if (!entry || entry.clientId !== client.client_id) {
      throw new Error('Invalid authorization code');
    }
    if (entry.expiresAt < Date.now()) {
      authCodes.delete(authorizationCode);
      throw new Error('Authorization code expired');
    }
    authCodes.delete(authorizationCode);

    const access_token = randomToken(32);
    accessTokens.set(access_token, {
      clientId: client.client_id,
      customerId: 'demo-customer',
      expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
    });

    return {
      access_token,
      token_type: 'bearer',
      expires_in: TOKEN_TTL_SECONDS,
    };
  },

  async exchangeRefreshToken() {
    throw new Error('Refresh tokens are not supported in this POC');
  },

  async verifyAccessToken(token) {
    const entry = accessTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new Error('Invalid or expired token');
    }
    return {
      token,
      clientId: entry.clientId,
      scopes: ['fluid:mcp'],
      expiresAt: Math.floor(entry.expiresAt / 1000),
      extra: { customerId: entry.customerId },
    };
  },

  async revokeToken(client, request) {
    accessTokens.delete(request.token);
  },
};

module.exports = { oauthProvider };
