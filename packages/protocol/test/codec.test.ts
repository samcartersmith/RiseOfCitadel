import { describe, expect, it } from 'vitest';
import { decode, encode, MessageType, PROTOCOL_VERSION, type Message } from '../src';

describe('codec', () => {
  const cases: Message[] = [
    { type: MessageType.Hello, version: PROTOCOL_VERSION },
    { type: MessageType.Welcome, version: PROTOCOL_VERSION, serverTick: 123456 },
    { type: MessageType.Ping, time: 1234.5 },
    { type: MessageType.Pong, time: 99.25 },
    { type: MessageType.Reject, reason: 1 },
  ];

  it.each(cases)('round-trips %o', (msg) => {
    expect(decode(encode(msg))).toEqual(msg);
  });

  it('rejects malformed frames', () => {
    expect(decode(new ArrayBuffer(0))).toBeNull();
    expect(decode(new Uint8Array([MessageType.Welcome, 0]).buffer)).toBeNull();
    expect(decode(new Uint8Array([250]).buffer)).toBeNull();
  });
});
