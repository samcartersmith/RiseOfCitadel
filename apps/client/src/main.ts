import { DEFAULT_PORT } from '@citadel/protocol';
import { createEngine } from './render/engine';
import { createBootScene } from './render/scene';
import { readStats, type CitadelStats } from './render/stats';
import { createQualityController } from './render/tiers';
import { createPerfHud } from './render/hud';
import { registerShadowCaster, registerShadowReceiver } from './render/shadows';
import type { QualityTier } from './render/quality';
import { loadSampleHero } from './render/sampleHero';
import { connect, type ConnectionStatus } from './net/connection';
import { getMobaCamera, type MobaCamera } from './camera/mobaCamera';

declare global {
  interface Window {
    __citadelReady?: boolean;
    __citadelStats?: CitadelStats;
    __citadelSetTier?: (tier: QualityTier) => void;
    __citadelCamera?: MobaCamera;
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;

const { engine, backend } = await createEngine(canvas);
const scene = createBootScene(engine);
// No heroes yet: Space recenters on the world origin. M2 passes the local hero here.
const camera = getMobaCamera(scene);
camera?.follow(() => ({ x: 0, z: 0 }), { lock: false });
window.__citadelCamera = camera;
await loadSampleHero(scene).catch((err) =>
  console.error('[citadel] sample hero failed to load', err),
);

// Placeholder shadow wiring until the map/unit modules register their own meshes.
for (const mesh of scene.meshes) {
  if (mesh.name === 'ground' || mesh.name === 'river') registerShadowReceiver(mesh);
  else if (!mesh.parent) registerShadowCaster(mesh);
}
const quality = createQualityController(engine, scene, backend);
const hud = createPerfHud(overlay, (tier) => quality.setTier(tier));
window.__citadelSetTier = (tier) => quality.setTier(tier);

// Server connection: automatic in dev, opt-in elsewhere with ?server=ws://host:port
const params = new URLSearchParams(location.search);
const serverUrl =
  params.get('server') ?? (import.meta.env.DEV ? `ws://localhost:${DEFAULT_PORT}` : null);
let net: ConnectionStatus = { state: 'offline' };
if (serverUrl) connect(serverUrl, (s) => (net = s));

let frames = 0;
readStats(engine, scene, backend, quality.tier); // attach instrumentation before the first frame
const READY_AFTER_FRAMES = 30; // let loading, shader compiles and counters settle
engine.runRenderLoop(() => {
  scene.render();
  frames++;
  if (frames % 15 === 0) {
    const stats = readStats(engine, scene, backend, quality.tier);
    window.__citadelStats = stats;
    const netLine =
      net.state === 'connected'
        ? `server  ok${net.rttMs !== null ? ` ${net.rttMs}ms` : ''}`
        : `server  ${net.state}`;
    hud.update(stats, [netLine]);
    if (frames >= READY_AFTER_FRAMES) window.__citadelReady = true;
  }
});

window.addEventListener('resize', () => engine.resize());
