/**
 * Map ↔ world scale shared by every map module (terrain, structures, foliage, water).
 *
 * Map spec coordinates (packages/content/src/map.ts) are "map units" on a 16000² board,
 * +x east, +z north. The client renders in "world units" (a displayed hero is ~5 tall).
 * Babylon is left-handed with +x east and +z north, so axes carry over; only scale changes.
 *
 * 32 puts the map at 500 world units across, a 750-unit lane at ~23 world units, and the
 * default MOBA camera view (~90 world units wide) at ~2900 map units.
 */
export const MAP_UNITS_PER_WORLD_UNIT = 32;

/** World units per map unit: 1 / MAP_UNITS_PER_WORLD_UNIT. */
export const MAP_TO_WORLD = 1 / MAP_UNITS_PER_WORLD_UNIT;
