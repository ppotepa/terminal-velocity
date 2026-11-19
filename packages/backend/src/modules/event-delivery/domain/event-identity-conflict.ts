/** A repeated event ID must always describe the same immutable fact. */
export class EventIdentityConflict extends Error {
  readonly code = 'EVENT_ID_CONFLICT';

  constructor() {
    super('An event ID was reused with different immutable content.');
    this.name = 'EventIdentityConflict';
  }
}
