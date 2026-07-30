export type {
  CompareAndSwapPersistenceAdapter,
  PersistenceAdapter,
  VersionedAggregate,
  VersionedAggregateStore,
} from './types.js';
export {
  InMemoryPersistenceAdapter,
  InMemoryVersionedAggregateStore,
} from './in-memory-adapter.js';
export { FileCompareAndSwapPersistenceAdapter } from './file-cas-adapter.js';
