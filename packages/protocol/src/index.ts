/**
 * Wire protocol shared by client and server. M0 only has the version
 * handshake and a ping; M3-01 adds the bit-packed command/snapshot codec.
 */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 7777;

export const enum MessageType {
  Hello = 1,
  Welcome = 2,
  Ping = 3,
  Pong = 4,
  Reject = 5,
}

export type Message =
  | { type: MessageType.Hello; version: number }
  | { type: MessageType.Welcome; version: number; serverTick: number }
  | { type: MessageType.Ping; time: number }
  | { type: MessageType.Pong; time: number }
  | { type: MessageType.Reject; reason: number };

export const enum RejectReason {
  VersionMismatch = 1,
  Malformed = 2,
}

/** Encode a message to a compact binary frame. */
export function encode(msg: Message): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(9));
  view.setUint8(0, msg.type);
  switch (msg.type) {
    case MessageType.Hello:
      view.setUint16(1, msg.version);
      return view.buffer.slice(0, 3);
    case MessageType.Welcome:
      view.setUint16(1, msg.version);
      view.setUint32(3, msg.serverTick);
      return view.buffer.slice(0, 7);
    case MessageType.Ping:
    case MessageType.Pong:
      view.setFloat64(1, msg.time);
      return view.buffer;
    case MessageType.Reject:
      view.setUint8(1, msg.reason);
      return view.buffer.slice(0, 2);
  }
}

/** Decode a binary frame. Returns null for malformed input (never throws). */
export function decode(buf: ArrayBuffer): Message | null {
  if (buf.byteLength < 1) return null;
  const view = new DataView(buf);
  const type = view.getUint8(0);
  try {
    switch (type) {
      case MessageType.Hello:
        return { type, version: view.getUint16(1) };
      case MessageType.Welcome:
        return { type, version: view.getUint16(1), serverTick: view.getUint32(3) };
      case MessageType.Ping:
      case MessageType.Pong:
        return { type, time: view.getFloat64(1) };
      case MessageType.Reject:
        return { type, reason: view.getUint8(1) };
      default:
        return null;
    }
  } catch {
    return null; // RangeError: frame too short
  }
}
