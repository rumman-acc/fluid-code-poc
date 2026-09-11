'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

class DeviceBroker extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map();
  }

  attach(socket, deviceId, deviceSecret) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(deviceId || '') || !deviceSecret) {
      socket.close(1008, 'Invalid device credentials');
      return;
    }

    let device = this.devices.get(deviceId);
    if (device && device.secret !== deviceSecret) {
      socket.close(1008, 'Invalid device credentials');
      return;
    }
    if (!device) {
      device = {
        id: deviceId,
        secret: deviceSecret,
        pairingCode: token(9),
        pairingExpiresAt: Date.now() + 10 * 60 * 1000,
        controlToken: null,
        socket: null,
        online: false,
        name: 'Windows computer',
        agents: {},
        workspace: null,
        busy: false,
        events: [],
        lastSeen: null,
      };
      this.devices.set(deviceId, device);
    }
    if (!device.controlToken && device.pairingExpiresAt < Date.now()) {
      device.pairingCode = token(9);
      device.pairingExpiresAt = Date.now() + 10 * 60 * 1000;
    }

    if (device.socket && device.socket !== socket) device.socket.close(1000, 'Reconnected');
    device.socket = socket;
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    device.online = true;
    device.lastSeen = new Date().toISOString();
    socket.send(JSON.stringify({
      type: 'welcome',
      paired: !!device.controlToken,
      pairingCode: device.controlToken ? null : device.pairingCode,
    }));

    socket.on('message', (raw) => this.handleMessage(device, raw));
    socket.on('error', () => {});
    socket.on('close', () => {
      if (device.socket === socket) {
        device.socket = null;
        device.online = false;
        device.busy = false;
        device.lastSeen = new Date().toISOString();
        this.emit('changed', device.id);
      }
    });
  }

  handleMessage(device, raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    device.lastSeen = new Date().toISOString();
    if (message.type === 'hello') {
      device.name = String(message.name || 'Windows computer').slice(0, 100);
      device.agents = message.agents || {};
    } else if (message.type === 'workspace') {
      device.workspace = message.path || null;
    } else if (message.type === 'run_state') {
      device.busy = message.status === 'running';
      this.addEvent(device, {
        type: message.status === 'error' ? 'error' : 'log',
        message: message.message || `Agent ${message.status}`,
      });
    } else if (message.type === 'activity') {
      this.addEvent(device, { type: message.level === 'error' ? 'error' : 'log', message: message.message });
    }
    this.emit('changed', device.id);
  }

  addEvent(device, entry) {
    device.events.push({ ts: new Date().toISOString(), ...entry });
    if (device.events.length > 500) device.events.shift();
  }

  claim(pairingCode) {
    const device = [...this.devices.values()].find((candidate) => candidate.pairingCode === pairingCode);
    if (!device || device.pairingExpiresAt < Date.now()) return null;
    device.controlToken = token(32);
    device.pairingCode = null;
    return { deviceId: device.id, controlToken: device.controlToken, device: this.publicDevice(device) };
  }

  authorized(deviceId, controlToken) {
    const device = this.devices.get(deviceId);
    if (!device || !device.controlToken) return null;
    const expected = Buffer.from(device.controlToken);
    const supplied = Buffer.from(String(controlToken || ''));
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied) ? device : null;
  }

  publicDevice(device) {
    return {
      id: device.id,
      name: device.name,
      online: device.online,
      agents: device.agents,
      workspace: device.workspace,
      busy: device.busy,
      lastSeen: device.lastSeen,
    };
  }

  send(device, action, payload = {}) {
    if (!device || !device.online || !device.socket) return false;
    device.socket.send(JSON.stringify({ type: 'command', action, ...payload }));
    return true;
  }
}

module.exports = new DeviceBroker();
