/**
 * Minimal WebSocket RPC client for communicating with the ink gateway.
 *
 * Short-lived — coral workflows connect, execute, then disconnect.
 * Follows the same JSON-RPC pattern used by tentacle.
 */

import WebSocket from 'ws';

/** JSON-RPC request shape. */
interface RPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC response shape. */
interface RPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Streaming token event from chat.send. */
interface TokenEvent {
  jsonrpc: '2.0';
  method: 'chat.token';
  params: { requestId: number; token: string };
}

/** Chat done event. */
interface ChatDoneEvent {
  jsonrpc: '2.0';
  method: 'chat.done';
  params: { requestId: number; fullText: string };
}

type RPCMessage = RPCResponse | TokenEvent | ChatDoneEvent;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private tokenBuffers = new Map<number, string>();

  constructor(private url: string) {}

  /** Connect to the gateway WebSocket. */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as RPCMessage;
          this.handleMessage(msg);
        } catch (err) {
          console.warn('[gateway] Malformed message:', err instanceof Error ? err.message : String(err));
        }
      });

      this.ws.on('close', () => {
        // Reject all pending requests
        for (const [, { reject: rej }] of this.pending) {
          rej(new Error('WebSocket connection closed'));
        }
        this.pending.clear();
        this.ws = null;
      });
    });
  }

  /** Disconnect from the gateway. */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Send a JSON-RPC call and wait for the response. */
  async call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    const id = ++this.requestId;
    const request: RPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * Send a chat message and collect the full streamed response.
   * Accumulates chat.token events until chat.done.
   */
  async chat(
    message: string,
    options?: { realm?: string; entity?: string },
  ): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    const id = ++this.requestId;
    this.tokenBuffers.set(id, '');

    const request: RPCRequest = {
      jsonrpc: '2.0',
      id,
      method: 'chat.send',
      params: {
        message,
        ...options,
      },
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => {
          const fullText = this.tokenBuffers.get(id) ?? '';
          this.tokenBuffers.delete(id);
          resolve(fullText);
        },
        reject: (err) => {
          this.tokenBuffers.delete(id);
          reject(err);
        },
      });
      this.ws!.send(JSON.stringify(request));
    });
  }

  /** Whether the client is currently connected. */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private handleMessage(msg: RPCMessage): void {
    // Streaming token events
    if ('method' in msg && msg.method === 'chat.token') {
      const buf = this.tokenBuffers.get(msg.params.requestId);
      if (buf !== undefined) {
        this.tokenBuffers.set(
          msg.params.requestId,
          buf + msg.params.token,
        );
      }
      return;
    }

    // Chat done events — resolve the pending chat call
    if ('method' in msg && msg.method === 'chat.done') {
      const pending = this.pending.get(msg.params.requestId);
      if (pending) {
        this.tokenBuffers.set(
          msg.params.requestId,
          msg.params.fullText,
        );
        this.pending.delete(msg.params.requestId);
        pending.resolve(undefined);
      }
      return;
    }

    // Standard RPC responses
    if ('id' in msg) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(
            new Error(`RPC error ${msg.error.code}: ${msg.error.message}`),
          );
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }
}
