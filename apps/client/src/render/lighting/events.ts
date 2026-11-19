/**
 * The lighting-change event other modules (water M1-06, foliage M1-07, VFX)
 * subscribe to instead of reading lights directly:
 *
 *   const off = onLightingChange(scene, (p) => {
 *     waterMat.setColor3('skyTint', Color3.FromArray(p.skyHorizon));
 *     motes.intensity = 0.4 + 0.6 * p.night;
 *   });
 *
 * The callback fires once immediately if the scene already has a palette,
 * then whenever the rig's `t` changes (every frame while auto-cycling, so keep
 * it to uniform writes). Subscribing before the rig exists is fine.
 */
import type { Scene } from '@babylonjs/core/scene';
import type { LightingPalette } from './keyframes';

export type LightingListener = (palette: LightingPalette) => void;

interface Channel {
  palette: LightingPalette | null;
  listeners: Set<LightingListener>;
}

const channels = new WeakMap<Scene, Channel>();

function channelFor(scene: Scene): Channel {
  let c = channels.get(scene);
  if (!c) {
    c = { palette: null, listeners: new Set() };
    channels.set(scene, c);
  }
  return c;
}

/** Subscribes to lighting changes in a scene. Returns an unsubscribe function. */
export function onLightingChange(scene: Scene, cb: LightingListener): () => void {
  const c = channelFor(scene);
  c.listeners.add(cb);
  if (c.palette) cb(c.palette);
  return () => c.listeners.delete(cb);
}

/** The scene's current palette, or null when no lighting rig runs. */
export function getLightingPalette(scene: Scene): LightingPalette | null {
  return channels.get(scene)?.palette ?? null;
}

/** Called by the rig: stores the palette and notifies subscribers. */
export function publishLighting(scene: Scene, palette: LightingPalette | null): void {
  const c = channelFor(scene);
  c.palette = palette;
  if (!palette) return;
  for (const cb of c.listeners) {
    try {
      cb(palette);
    } catch (err) {
      console.error('[citadel] lighting listener failed', err);
    }
  }
}
