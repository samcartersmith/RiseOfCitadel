import { describe, expect, it } from 'vitest';
import { Document } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import { assertAllPresent, filterNodes, keepAnimations, optionTransforms } from './modelOptions';

/** A tiny scene: a rig with a skinned body, a hand slot with two props, and three animations. */
function fixture() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (n: number) =>
    doc.createAccessor().setType('SCALAR').setArray(new Float32Array(n)).setBuffer(buffer);
  const mesh = (name: string) =>
    doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute('POSITION', acc(3)));
  const scene = doc.createScene();
  const rig = doc.createNode('Rig');
  const hand = doc.createNode('handslot.r');
  const body = doc.createNode('Body').setMesh(mesh('Body'));
  const sword = doc.createNode('Sword').setMesh(mesh('Sword'));
  const axe = doc.createNode('Axe').setMesh(mesh('Axe'));
  const gem = doc.createNode('Axe_Gem').setMesh(mesh('Axe_Gem'));
  axe.addChild(gem);
  hand.addChild(sword).addChild(axe);
  rig.addChild(hand).addChild(body);
  scene.addChild(rig);
  for (const name of ['Idle', 'Run', 'T-Pose']) {
    const sampler = doc.createAnimationSampler().setInput(acc(2)).setOutput(acc(2));
    const channel = doc
      .createAnimationChannel()
      .setTargetNode(hand)
      .setTargetPath('rotation')
      .setSampler(sampler);
    doc.createAnimation(name).addSampler(sampler).addChannel(channel);
  }
  return doc;
}

const names = (list: { getName(): string }[]) => list.map((x) => x.getName()).sort();

describe('model pipeline options', () => {
  it('keepAnimations strips other clips and their keyframe data', async () => {
    const doc = fixture();
    const before = doc.getRoot().listAccessors().length;
    await doc.transform(keepAnimations(['Idle', 'Run']), prune());
    expect(names(doc.getRoot().listAnimations())).toEqual(['Idle', 'Run']);
    // T-Pose's input + output accessors are gone, not just the animation.
    expect(doc.getRoot().listAccessors().length).toBe(before - 2);
  });

  it('keepAnimations fails loudly on a typo', async () => {
    const doc = fixture();
    await expect(doc.transform(keepAnimations(['Idel']))).rejects.toThrow(/Idel/);
  });

  it('removeNodes drops the node and its subtree but keeps bones', async () => {
    const doc = fixture();
    await doc.transform(filterNodes({ remove: ['Axe'] }), prune());
    expect(names(doc.getRoot().listNodes())).toEqual(['Body', 'Rig', 'Sword', 'handslot.r']);
    expect(names(doc.getRoot().listMeshes())).toEqual(['Body', 'Sword']);
  });

  it('keepNodes removes unlisted mesh nodes only', async () => {
    const doc = fixture();
    await doc.transform(filterNodes({ keep: ['Body', 'Sword'] }), prune());
    expect(names(doc.getRoot().listMeshes())).toEqual(['Body', 'Sword']);
    expect(names(doc.getRoot().listNodes())).toContain('handslot.r');
  });

  it('removeNodes fails loudly on a typo', async () => {
    const doc = fixture();
    await expect(doc.transform(filterNodes({ remove: ['Shield'] }))).rejects.toThrow(/Shield/);
  });

  it('is a no-op for manifests without the new fields', () => {
    expect(optionTransforms({})).toEqual([]);
    expect(optionTransforms({ quantize: false })).toEqual([]);
    expect(optionTransforms({ keepAnimations: ['Idle'], removeNodes: ['Axe'] })).toHaveLength(2);
  });

  it('assertAllPresent lists what is missing', () => {
    expect(() => assertAllPresent('x', ['a', 'b'], ['a'])).toThrow(/x not found in source: b/);
    expect(() => assertAllPresent('x', ['a'], ['a'])).not.toThrow();
  });
});
