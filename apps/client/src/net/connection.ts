import { decode, encode, MessageType, PROTOCOL_VERSION } from '@citadel/protocol';

export type ConnectionStatus =
  | { state: 'connecting' }
  | { state: 'connected'; rttMs: number | null }
  | { state: 'rejected'; reason: number }
  | { state: 'offline' };

/**
 * M0 connection: handshake + ping to show the client ↔ server path works.
 * M3-04 replaces this with the snapshot/interpolation client.
 */
export function connect(url: string, onStatus: (s: ConnectionStatus) => void): () => void {
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  onStatus({ state: 'connecting' });

  ws.onopen = () => ws.send(encode({ type: MessageType.Hello, version: PROTOCOL_VERSION }));
  ws.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
    const msg = decode(ev.data);
    if (!msg) return;
    if (msg.type === MessageType.Welcome) {
      onStatus({ state: 'connected', rttMs: null });
      pingTimer = setInterval(
        () => ws.send(encode({ type: MessageType.Ping, time: performance.now() })),
        1000,
      );
    } else if (msg.type === MessageType.Pong) {
      onStatus({ state: 'connected', rttMs: Math.round(performance.now() - msg.time) });
    } else if (msg.type === MessageType.Reject) {
      onStatus({ state: 'rejected', reason: msg.reason });
    }
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    onStatus({ state: 'offline' });
  };

  return () => ws.close();
}
