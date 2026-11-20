import type { SqlPool } from '../../../contracts/database/index.ts';
import type { CandidateDirectory } from '../../aircraft-correlation/public/index.ts';
import type { VerifiedSourceScope } from '../application/accept-source-delivery.ts';
import type { NormalizationContext } from '../application/normalize-source-observation.ts';
import type { SourceDeliveryOrigin } from '../ports/source-delivery-store.ts';
import { createPermittedProviderPipeline } from './create-permitted-provider-pipeline.ts';

/** Explicit offline helper; only synthetic content is authorized by this fixture scope. */
export function createSyntheticProviderPipeline(pool: SqlPool, directory: CandidateDirectory | undefined, now: () => number = Date.now) {
  const create = (scope: Pick<VerifiedSourceScope, 'sourceId' | 'provider' | 'accountScope' | 'sourceEpoch'>) =>
    createPermittedProviderPipeline(pool, directory, { ...scope, retentionAllowed: true,
      purpose: 'PRIVATE_PROCESSING', evidenceReference: 'repository-synthetic-fixtures-only' }, now);
  const { accept: _accept, ...worker } = create({ sourceId: 'src_synthetic' as VerifiedSourceScope['sourceId'],
    provider: 'synthetic' as VerifiedSourceScope['provider'], accountScope: 'private-fixture' as VerifiedSourceScope['accountScope'],
    sourceEpoch: 'v1' as VerifiedSourceScope['sourceEpoch'] });
  return { ...worker,
    async acceptFixture(input: unknown, context: NormalizationContext, scope: VerifiedSourceScope, origin: SourceDeliveryOrigin) {
      if (context.sourceId !== 'src_synthetic' || context.provider !== 'synthetic')
        throw new Error('Only explicitly synthetic fixture input may be retained.');
      return create(scope).accept(input, context, scope, origin);
    },
  };
}
