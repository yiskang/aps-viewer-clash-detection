import { makeFakeCheckpointPort } from '../fixtures/FakeCheckpointPort.mjs';
import { runCheckpointPortContractTests } from './checkpointPort.contract.mjs';

runCheckpointPortContractTests(() => makeFakeCheckpointPort({ controllableYield: true }), {
  suiteName: 'CheckpointPort contract (FakeCheckpointPort)',
});
