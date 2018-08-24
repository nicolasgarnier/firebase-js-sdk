/**
 * Copyright 2017 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DatabaseId, DatabaseInfo } from '../../../src/core/database_info';
import { IndexedDbPersistence } from '../../../src/local/indexeddb_persistence';
import { MemoryPersistence } from '../../../src/local/memory_persistence';
import { SimpleDb } from '../../../src/local/simple_db';
import { JsonProtoSerializer } from '../../../src/remote/serializer';
import {
  WebStorageSharedClientState,
  ClientId
} from '../../../src/local/shared_client_state';
import {
  BatchId,
  MutationBatchState,
  OnlineState,
  TargetId
} from '../../../src/core/types';
import { AsyncQueue } from '../../../src/util/async_queue';
import { User } from '../../../src/auth/user';
import {
  QueryTargetState,
  SharedClientStateSyncer
} from '../../../src/local/shared_client_state_syncer';
import { FirestoreError } from '../../../src/util/error';
import { AutoId } from '../../../src/util/misc';
import { PlatformSupport } from '../../../src/platform/platform';
import { LocalSerializer } from '../../../src/local/local_serializer';
import { SnapshotVersion } from '../../../src/core/snapshot_version';

/** The prefix used by the keys that Firestore writes to Local Storage. */
const LOCAL_STORAGE_PREFIX = 'firestore_';

/** The Database ID used by most tests that access IndexedDb. */
export const INDEXEDDB_TEST_DATABASE_ID = new DatabaseId('test-project');

/** The DatabaseInfo used by most tests that access IndexedDb. */
const INDEXEDDB_TEST_DATABASE_INFO = new DatabaseInfo(
  INDEXEDDB_TEST_DATABASE_ID,
  'PersistenceTestHelpers',
  'host',
  /*ssl=*/ false
);

/** The persistence prefix used for testing in IndexedBD and LocalStorage. */
export const TEST_PERSISTENCE_PREFIX = IndexedDbPersistence.buildStoragePrefix(
  INDEXEDDB_TEST_DATABASE_INFO
);

/**
 * The database name used by tests that access IndexedDb. To be used in
 * conjunction with `INDEXEDDB_TEST_DATABASE_INFO` and
 * `INDEXEDDB_TEST_DATABASE_ID`.
 */
export const INDEXEDDB_TEST_DATABASE_NAME =
  IndexedDbPersistence.buildStoragePrefix(INDEXEDDB_TEST_DATABASE_INFO) +
  IndexedDbPersistence.MAIN_DATABASE;

/**
 * IndexedDb serializer that uses `INDEXEDDB_TEST_DATABASE_ID` as its database
 * id.
 */
export const INDEXEDDB_TEST_SERIALIZER = new LocalSerializer(
  new JsonProtoSerializer(INDEXEDDB_TEST_DATABASE_ID, {
    useProto3Json: true
  })
);

/**
 * Creates and starts an IndexedDbPersistence instance for testing, destroying
 * any previous contents if they existed.
 */
export async function testIndexedDbPersistence(
  options: {
    dontPurgeData?: boolean;
    synchronizeTabs?: boolean;
  } = {}
): Promise<IndexedDbPersistence> {
  const queue = new AsyncQueue();
  const clientId = AutoId.newId();
  const prefix = `${TEST_PERSISTENCE_PREFIX}/`;
  if (!options.dontPurgeData) {
    await SimpleDb.delete(prefix + IndexedDbPersistence.MAIN_DATABASE);
  }
  const serializer = new JsonProtoSerializer(INDEXEDDB_TEST_DATABASE_ID, {
    useProto3Json: true
  });
  const platform = PlatformSupport.getPlatform();
  const persistence = new IndexedDbPersistence(
    TEST_PERSISTENCE_PREFIX,
    clientId,
    platform,
    queue,
    serializer,
    !!options.synchronizeTabs
  );
  await persistence.start();
  return persistence;
}

/** Creates and starts a MemoryPersistence instance for testing. */
export async function testMemoryPersistence(): Promise<MemoryPersistence> {
  const persistence = new MemoryPersistence(AutoId.newId());
  await persistence.start();
  return persistence;
}

class NoOpSharedClientStateSyncer implements SharedClientStateSyncer {
  constructor(private readonly activeClients: ClientId[]) {}
  async applyBatchState(
    batchId: BatchId,
    snapshotVersion: SnapshotVersion,
    state: MutationBatchState,
    error?: FirestoreError
  ): Promise<void> {}
  async applySuccessfulWrite(batchId: BatchId): Promise<void> {}
  async rejectFailedWrite(
    batchId: BatchId,
    err: FirestoreError
  ): Promise<void> {}
  async getActiveClients(): Promise<ClientId[]> {
    return this.activeClients;
  }
  async applyTargetState(
    targetId: TargetId,
    snapshotVersion: SnapshotVersion,
    state: QueryTargetState,
    error?: FirestoreError
  ): Promise<void> {}
  async applyActiveTargetsChange(
    added: TargetId[],
    removed: TargetId[]
  ): Promise<void> {}
  applyOnlineStateChange(onlineState: OnlineState): void {}
}
/**
 * Populates Web Storage with instance data from a pre-existing client.
 */
export async function populateWebStorage(
  user: User,
  existingClientId: ClientId,
  existingMutationBatchIds: BatchId[],
  existingQueryTargetIds: TargetId[]
): Promise<void> {
  // HACK: Create a secondary client state to seed data into LocalStorage.
  // NOTE: We don't call shutdown() on it because that would delete the data.
  const secondaryClientState = new WebStorageSharedClientState(
    new AsyncQueue(),
    PlatformSupport.getPlatform(),
    TEST_PERSISTENCE_PREFIX,
    existingClientId,
    user
  );

  secondaryClientState.syncEngine = new NoOpSharedClientStateSyncer([
    existingClientId
  ]);
  secondaryClientState.onlineStateHandler = () => {};
  await secondaryClientState.start();

  for (const batchId of existingMutationBatchIds) {
    secondaryClientState.addPendingMutation(batchId);
  }

  for (const targetId of existingQueryTargetIds) {
    secondaryClientState.addLocalQueryTarget(targetId);
  }
}

/**
 * Removes Firestore data (by prefix match) from Local Storage.
 */
export function clearWebStorage(): void {
  for (let i = 0; ; ++i) {
    const key = window.localStorage.key(i);
    if (key === null) {
      break;
    } else if (key.startsWith(LOCAL_STORAGE_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}
