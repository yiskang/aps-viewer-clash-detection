import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';
import { runCheckpointPortContractTests } from './checkpointPort.contract.mjs';

runCheckpointPortContractTests(() => makeFakeCheckpointPort(), {
  suiteName: 'CheckpointPort contract (FakeCheckpointPort)',
});
