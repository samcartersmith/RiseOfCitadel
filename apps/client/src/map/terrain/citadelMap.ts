import type { MapSpec } from '@citadel/content';
// The content package only exports its TypeScript entry; the JSON is read by path so the
// client bundle doesn't pull in zod. It is validated in CI by `pnpm validate:content`.
import citadelJson from '../../../../../packages/content/data/map/citadel.json';

/** The Citadel map spec (packages/content/data/map/citadel.json). */
export const CITADEL_MAP = citadelJson as unknown as MapSpec;
