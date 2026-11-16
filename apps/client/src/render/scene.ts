import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

/** Palette from docs/design/art-direction.md §2.1. */
export const Palette = {
  wardenStone: Color3.FromHexString('#CFC6B4'),
  wardenMoss: Color3.FromHexString('#6F9A4E'),
  hollowAsh: Color3.FromHexString('#5E5A63'),
  riverLight: Color3.FromHexString('#7FE3E0'),
  wardenGold: Color3.FromHexString('#E8B54A'),
  hollowViolet: Color3.FromHexString('#8E5BD9'),
} as const;

function flat(scene: Scene, name: string, color: Color3) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = Color3.Black();
  return m;
}

/**
 * M0 placeholder scene: a palette-coloured ground split by a river, and one
 * marker per faction. M1 replaces this with the real map.
 */
export function createBootScene(engine: AbstractEngine): Scene {
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString('#1B1A1FFF');

  // Fixed MOBA-style angle (~55° pitch). M1-03 builds the real camera.
  const camera = new ArcRotateCamera('cam', -Math.PI / 2, 0.6, 60, Vector3.Zero(), scene);
  camera.lowerRadiusLimit = 30;
  camera.upperRadiusLimit = 90;
  camera.attachControl(true);

  new HemisphericLight('sky', new Vector3(0, 1, 0), scene).intensity = 0.6;
  const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.4), scene);
  sun.intensity = 0.9;

  const ground = MeshBuilder.CreateGround('ground', { width: 64, height: 64 }, scene);
  ground.material = flat(scene, 'm-ground', Palette.wardenMoss);

  const river = MeshBuilder.CreateGround('river', { width: 92, height: 6 }, scene);
  river.position.y = 0.02;
  river.rotation.y = Math.PI / 4;
  river.material = flat(scene, 'm-river', Palette.riverLight);

  const hearth = MeshBuilder.CreateCylinder('hearthstone', { height: 6, diameter: 4 }, scene);
  hearth.position.set(-24, 3, -24);
  hearth.material = flat(scene, 'm-warden', Palette.wardenGold);

  const crown = MeshBuilder.CreateTorus('hollow-crown', { diameter: 5, thickness: 1 }, scene);
  crown.position.set(24, 5, 24);
  crown.material = flat(scene, 'm-hollow', Palette.hollowViolet);
  scene.onBeforeRenderObservable.add(() => {
    crown.rotation.y += engine.getDeltaTime() * 0.001;
  });

  return scene;
}
