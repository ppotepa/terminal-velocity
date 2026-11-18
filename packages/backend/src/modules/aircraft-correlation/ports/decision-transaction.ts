import type { MessageId } from '../../../contracts/identity/index.ts';
import type { DecisionEvent } from '../application/decision-event.ts';
import type { StoredDecision } from '../application/stored-decision.ts';
/** Tylko uprawnienia niezbędne do atomowego zapisu decyzji i outboxu. */
export interface DecisionWriteSet {
  read(messageId: MessageId): Promise<StoredDecision | null>;
  put(decision: StoredDecision): Promise<void>;
  appendOutbox(event: DecisionEvent): Promise<void>;
}
/**
 * Gwarancje adaptera:
 * 1. put + appendOutbox commitują atomowo albo oba są wycofane.
 * 2. Cykl read -> porównanie expectedRevision -> put jest serializowany per MessageId
 *    (lub adapter realizuje równoważny CAS), także gdy rekord jeszcze nie istnieje.
 *    Dwa callbacki nie mogą skutecznie commitować z tej samej expectedRevision.
 * 3. Konflikt pierwszego INSERT nie może dać dwóch decyzji/outboxów.
 * 4. Scope writes wygasa wraz z callbackiem; żadnych wywołań po commit/rollback.
 *
 * Samo BEGIN/COMMIT w PostgreSQL READ COMMITTED nie zapewnia punktu 2.
 * Adapter SQL wymaga rzeczywistej blokady/CAS/serializacji oraz testów integracyjnych.
 */
export interface DecisionTransaction {
  run<T>(work: (writes: DecisionWriteSet) => Promise<T>): Promise<T>;
}
