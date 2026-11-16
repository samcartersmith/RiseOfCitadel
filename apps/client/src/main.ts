import { DEFAULT_PORT } from '@citadel/protocol';
import { createEngine } from './render/engine';
import { createBootScene } from './render/scene';
import { readStats, type CitadelStats } from './render/stats';
import { connect, type ConnectionStatus } from './net/connection';

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;

const { engine, backend } = await createEngine(canvas);
const scene = createBootScene(engine);

// Server connection: automatic in dev, opt-in elsewhere with ?server=ws://host:port
const params = new URLSearchParams(location.search);
const serverUrl =
  params.get('server') ?? (import.meta.env.DEV ? `ws://localhost:${DEFAULT_PORT}` : null);
let net: ConnectionStatus = { state: 'offline' };
if (serverUrl) connect(serverUrl, (s) => (net = s));

let frames = 0;
engine.runRenderLoop(() => {
  scene.render();
  if (++frames === 3) window.__citadelReady = true; // a few frames in: scene is on screen
  if (frames % 15 === 0) {
    const stats = readStats(engine, scene, backend);
    window.__citadelStats = stats;
    const netLine =
      net.state === 'connected'
        ? `server  ok${net.rttMs !== null ? ` ${net.rttMs}ms` : ''}`
        : `server  ${net.state}`;
    overlay.textContent = [
      `${stats.backend}  ${stats.fps} fps`,
      `draws   ${stats.drawCalls}`,
      `meshes  ${stats.activeMeshes}`,
      `tris    ${Math.round(stats.activeIndices / 3)}`,
      netLine,
    ].join('\n');
  }
});

window.addEventListener('resize', () => engine.resize());
