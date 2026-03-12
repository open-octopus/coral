import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { GatewayClient } from './gateway-client.js';

function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = require('node:net').createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

describe('GatewayClient', () => {
  let wss: WebSocketServer;
  let port: number;
  let client: GatewayClient;

  beforeEach(async () => {
    port = await findFreePort();
    wss = new WebSocketServer({ port });
    client = new GatewayClient(`ws://localhost:${port}`);
  });

  afterEach(async () => {
    client.disconnect();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it('connects and reports connected state', async () => {
    await client.connect();
    expect(client.connected).toBe(true);
  });

  it('disconnects cleanly', async () => {
    await client.connect();
    client.disconnect();
    expect(client.connected).toBe(false);
  });

  it('sends RPC call and receives response', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const req = JSON.parse(data.toString());
        ws.send(
          JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }),
        );
      });
    });

    await client.connect();
    const result = await client.call('status.health');
    expect(result).toEqual({ ok: true });
  });

  it('call throws when not connected', async () => {
    await expect(client.call('status.health')).rejects.toThrow(
      'Not connected to gateway',
    );
  });

  it('rejects pending requests on connection close', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', () => {
        // Never respond — close the connection instead
        ws.close();
      });
    });

    await client.connect();
    const callPromise = client.call('status.health');
    await expect(callPromise).rejects.toThrow('WebSocket connection closed');
  });

  it('returns error responses as rejected promises', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const req = JSON.parse(data.toString());
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: 404, message: 'Not found' },
          }),
        );
      });
    });

    await client.connect();
    await expect(
      client.call('realm.get', { id: 'nonexistent' }),
    ).rejects.toThrow('RPC error 404: Not found');
  });

  it('chat accumulates streaming tokens', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const req = JSON.parse(data.toString());
        // Send token events
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'chat.token',
            params: { requestId: req.id, token: 'Hello' },
          }),
        );
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'chat.token',
            params: { requestId: req.id, token: ' world' },
          }),
        );
        // Send done event
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'chat.done',
            params: { requestId: req.id, fullText: 'Hello world' },
          }),
        );
      });
    });

    await client.connect();
    const result = await client.chat('hi');
    expect(result).toBe('Hello world');
  });

  it('chat returns fullText from chat.done', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const req = JSON.parse(data.toString());
        // Skip token events — send chat.done directly with fullText
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'chat.done',
            params: {
              requestId: req.id,
              fullText: 'Complete response from server',
            },
          }),
        );
      });
    });

    await client.connect();
    const result = await client.chat('hello', {
      realm: 'test',
      entity: 'bot',
    });
    expect(result).toBe('Complete response from server');
  });

  it('logs warning for malformed messages', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    wss.on('connection', (ws) => {
      // Send invalid JSON
      ws.send('not-json{{{');
    });

    await client.connect();

    // Give the message time to arrive
    await new Promise((r) => setTimeout(r, 50));

    expect(spy).toHaveBeenCalledWith(
      '[gateway] Malformed message:',
      expect.stringContaining(''),
    );

    spy.mockRestore();
  });
});
