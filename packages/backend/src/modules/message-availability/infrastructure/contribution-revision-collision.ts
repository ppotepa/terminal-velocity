export class ContributionRevisionCollision extends Error {
  readonly code = 'REVISION_COLLISION';

  constructor() {
    super('A contribution revision was reused with different facts.');
    this.name = 'ContributionRevisionCollision';
  }
}
