import { DEFAULT_PORT } from '@citadel/protocol';
import { startServer } from './server';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
// LAN play (M3-08) will set HOST=0.0.0.0; default to loopback only.
const host = process.env.HOST ?? '127.0.0.1';

const server = startServer({ port, host });
await server.ready;
console.log(`[citadel] server listening on ws://${host}:${port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void server.close().then(() => process.exit(0)));
}
