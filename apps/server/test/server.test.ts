import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { decode, encode, MessageType, PROTOCOL_VERSION, type Message } from '@citadel/protocol';
import { startServer } from '../src/server';

let server: ReturnType<typeof startServer> | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.binaryType = 'arraybuffer';
  const next = () =>
    new Promise<Message | null>((resolve) =>
      ws.once('message', (d: ArrayBuffer) => resolve(decode(d))),
    );
  const open = new Promise<void>((resolve) => ws.once('open', () => resolve()));
  return { ws, next, open };
}

describe('server handshake', () => {
  it('welcomes a matching client and answers pings', async () => {
    server = startServer({ port: 17777 });
    await server.ready;
    const c = connect(17777);
    await c.open;
    c.ws.send(encode({ type: MessageType.Hello, version: PROTOCOL_VERSION }));
    expect((await c.next())?.type).toBe(MessageType.Welcome);
    c.ws.send(encode({ type: MessageType.Ping, time: 42 }));
    expect(await c.next()).toEqual({ type: MessageType.Pong, time: 42 });
    c.ws.close();
  });

  it('rejects a client on the wrong protocol version', async () => {
    server = startServer({ port: 17778 });
    await server.ready;
    const c = connect(17778);
    await c.open;
    c.ws.send(encode({ type: MessageType.Hello, version: PROTOCOL_VERSION + 1 }));
    expect((await c.next())?.type).toBe(MessageType.Reject);
  });
});
