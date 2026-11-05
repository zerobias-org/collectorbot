import { DynamicDataProducerHubImpl } from '@zerobias-org/module-interface-dataproducer';
import { CollectorZerobiasZerobiasDynamicImpl } from './CollectorZerobiasZerobiasDynamicImpl.js';
import { container, TYPES } from '../generated/index.js';

/**
 * Bind the DataProducer unconnected, in place of the generated binding, which
 * connects it while the client is built. Connecting reads the Hub target's
 * metadata, so an unreachable target failed every job before `run`, even one
 * whose mappings only read uploaded files. The collector connects it itself
 * when a mapping reads from the target (see its `init`).
 *
 * hub-client imports this module first, by `main`, so the generated container
 * exists by now. An entry that imports the generated container first, such as
 * generated/run.ts, gets here inside the import cycle through
 * generated/inversify.config.ts before the container is initialized, and
 * keeps the generated binding.
 */
function bindDataProducerUnconnected(): void {
  try {
    container.rebind(TYPES.dataproducer).toDynamicValue(() => new DynamicDataProducerHubImpl());
  } catch (error) {
    if (!(error instanceof ReferenceError)) {
      throw error;
    }
  }
}

bindDataProducerUnconnected();

export default CollectorZerobiasZerobiasDynamicImpl;
export * from '../generated/index.js';
export * from './types/index.js';
export * from './Mappers.js';
