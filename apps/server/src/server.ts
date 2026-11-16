import { WebSocketServer, type WebSocket } from 'ws';
import { decode, encode, MessageType, PROTOCOL_VERSION, RejectReason } from '@citadel/protocol';
import { TICK_SECONDS, World } from '@citadel/sim';

export interface ServerOptions {
  port: number;
  host?: string;
}

/**
 * M0 server: owns one World ticking at TICK_RATE and answers the protocol
 * handshake + pings. M3-02 turns this into the full authoritative match loop.
 */
export function startServer({ port, host = '127.0.0.1' }: ServerOptions) {
  const world = new World({ seed: Date.now() >>> 0 });
  const timer = setInterval(() => world.step(), TICK_SECONDS * 1000);
  const wss = new WebSocketServer({ port, host });

  wss.on('connection', (socket: WebSocket) => {
    let greeted = false;
    socket.binaryType = 'arraybuffer';

    socket.on('message', (data: ArrayBuffer, isBinary: boolean) => {
      const msg = isBinary ? decode(data) : null;
      if (!msg) {
        socket.send(encode({ type: MessageType.Reject, reason: RejectReason.Malformed }));
        socket.close();
        return;
      }
      if (!greeted) {
        if (msg.type !== MessageType.Hello || msg.version !== PROTOCOL_VERSION) {
          socket.send(encode({ type: MessageType.Reject, reason: RejectReason.VersionMismatch }));
          socket.close();
          return;
        }
        greeted = true;
        socket.send(
          encode({ type: MessageType.Welcome, version: PROTOCOL_VERSION, serverTick: world.tick }),
        );
        return;
      }
      if (msg.type === MessageType.Ping) {
        socket.send(encode({ type: MessageType.Pong, time: msg.time }));
      }
    });
  });

  const ready = new Promise<void>((resolve) => wss.once('listening', () => resolve()));

  return {
    world,
    ready,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
