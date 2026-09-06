// collision/index.js
//
// The single public entry point of the collision library. A pure re-export: this module runs no
// side effects of its own (in particular it never touches `globalThis.THREE` -- extraction reads
// that global, and only reads it, inside collision/viewer/ViewerModelAdapter.js).
//
// Consumers (e.g. wwwroot/extensions/RoomLocatorExtension.js) import from here, never from the
// individual implementation modules.

export { CollisionWorld, CapacityExceededError } from './CollisionWorld.js';
export {
  WorldDisposedError, ModelEvictedError, RenderProxyUnavailableError, ObjectTreeUnavailableError,
  ModelPlacementChangedError,
} from './errors.js';
export { ExtractionLimitExceededError } from './viewer/ViewerModelAdapter.js';
