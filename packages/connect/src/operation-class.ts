/**
 * Safe vs unsafe Connect adapter operation classification.
 *
 * Unsafe operations must not be blindly auto-retried after an ambiguous
 * failure. They require OUTCOME_UNKNOWN → reconcile via getBookingStatus
 * (or supplier getOrder) before any re-issue.
 */

export type AdapterOperationClass = 'safe' | 'unsafe';

export type AdapterOperationName =
  | 'searchFlights'
  | 'priceItinerary'
  | 'createBooking'
  | 'getBookingStatus'
  | 'requestTicketing'
  | 'cancelBooking'
  | 'healthCheck'
  | 'searchHotels'
  | 'getPropertyDetails'
  | 'checkRate'
  | 'modifyBooking'
  | string;

const SAFE_OPS = new Set<string>([
  'searchFlights',
  'priceItinerary',
  'getBookingStatus',
  'healthCheck',
  'searchHotels',
  'getPropertyDetails',
  'checkRate',
]);

const UNSAFE_OPS = new Set<string>([
  'createBooking',
  'requestTicketing',
  'cancelBooking',
  'modifyBooking',
]);

/**
 * Classify an adapter operation. Unknown names default to unsafe
 * (fail closed for money-path safety).
 */
export function classifyAdapterOperation(operation: AdapterOperationName): AdapterOperationClass {
  if (SAFE_OPS.has(operation)) return 'safe';
  if (UNSAFE_OPS.has(operation)) return 'unsafe';
  // Nested steps like createBooking:commit are unsafe if they contain a mutation root.
  for (const unsafe of UNSAFE_OPS) {
    if (operation === unsafe || operation.startsWith(`${unsafe}:`)) return 'unsafe';
  }
  for (const safe of SAFE_OPS) {
    if (operation === safe || operation.startsWith(`${safe}:`)) return 'safe';
  }
  return 'unsafe';
}

export function isUnsafeAdapterOperation(operation: AdapterOperationName): boolean {
  return classifyAdapterOperation(operation) === 'unsafe';
}
