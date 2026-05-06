/**
 * Payment Service — processes payments for bookings.
 *
 * Two modes, selected at construction time:
 *
 *   1. **Stripe mode** — a `Stripe` client (or compatible minimal shape)
 *      is injected. PaymentIntents are created at booking time and
 *      confirmed at pay time. Driven by the `STRIPE_SECRET_KEY` env var
 *      in production wiring (see server.ts).
 *
 *   2. **Mock mode** — no Stripe client. Payments always succeed with
 *      a synthetic `pay_mock_*` identifier. Existing demo + test flows
 *      continue to work exactly as before.
 *
 * Persistence: when a `SqliteStore` is provided, payment rows are
 * written to the `payments` table so they survive restart. Otherwise
 * only the booking's `paymentId` is recorded in the adapter.
 */

import type { BookingLifecycle, OtaAdapter, PaymentResult } from '../types.js';
import type { SqliteStore } from '../persistence/sqlite-store.js';

// ---------------------------------------------------------------------------
// Minimal Stripe shape used by PaymentService.
//
// We accept the real `Stripe` class (from `new Stripe(secretKey)`) OR any
// object that satisfies this narrow interface. The latter makes tests
// injectable without pulling in the full Stripe SDK.
// ---------------------------------------------------------------------------

export interface StripeLike {
  paymentIntents: {
    create(params: {
      amount: number;
      currency: string;
      metadata?: Record<string, string>;
      automatic_payment_methods?: { enabled: boolean };
    }): Promise<StripePaymentIntent>;
    confirm(
      id: string,
      params?: { payment_method?: string; return_url?: string },
    ): Promise<StripePaymentIntent>;
    retrieve(id: string): Promise<StripePaymentIntent>;
  };
}

export interface StripePaymentIntent {
  id: string;
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'requires_capture'
    | 'processing'
    | 'succeeded'
    | 'canceled';
  client_secret: string | null;
  amount: number;
  currency: string;
  last_payment_error?: { message?: string } | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface PaymentServiceOptions {
  /** Stripe client (real or mock). Omit for mock-mode. */
  stripe?: StripeLike;
  /** Optional persistence. When present, payment attempts are logged. */
  store?: SqliteStore;
}

export interface CreateIntentResult {
  /** Set when running in Stripe mode. Null in mock mode. */
  clientSecret: string | null;
  /** Stripe PaymentIntent ID, or null in mock mode. */
  paymentIntentId: string | null;
}

export class PaymentService {
  private readonly adapter: OtaAdapter & BookingLifecycle;
  private readonly stripe?: StripeLike;
  private readonly store?: SqliteStore;

  constructor(adapter: OtaAdapter & BookingLifecycle, options: PaymentServiceOptions = {}) {
    this.adapter = adapter;
    if (options.stripe) this.stripe = options.stripe;
    if (options.store) this.store = options.store;
  }

  /** True when the service is wired to a real Stripe client. */
  get usesStripe(): boolean {
    return this.stripe !== undefined;
  }

  /**
   * Create a Stripe PaymentIntent for the booking's total. In mock
   * mode this is a no-op and returns `{ clientSecret: null, paymentIntentId: null }`.
   *
   * Typically called immediately after `/api/book` so the frontend can
   * collect card details with Stripe.js against the returned client_secret.
   */
  async createIntent(bookingReference: string): Promise<CreateIntentResult> {
    const booking = await this.adapter.getBooking(bookingReference);
    if (!booking) throw new BookingNotFoundError(bookingReference);

    if (!this.stripe) {
      // Mock mode — nothing to do upfront.
      return { clientSecret: null, paymentIntentId: null };
    }

    // Stripe amounts are in smallest currency unit (cents for USD/EUR/etc).
    const amountMinor = toMinorUnits(booking.totalAmount, booking.currency);
    const intent = await this.stripe.paymentIntents.create({
      amount: amountMinor,
      currency: booking.currency.toLowerCase(),
      metadata: { booking_reference: bookingReference },
      automatic_payment_methods: { enabled: true },
    });

    // Record intent ID on the booking so the pay step can look it up.
    this.adapter.recordPayment(bookingReference, `pending_${intent.id}`, intent.id);

    this.store?.putPayment({
      paymentId: `pending_${intent.id}`,
      bookingReference,
      status: 'pending',
      amount: booking.totalAmount,
      currency: booking.currency,
      paymentIntentId: intent.id,
      ...(intent.client_secret ? { clientSecret: intent.client_secret } : {}),
      createdAt: new Date().toISOString(),
    });

    return { clientSecret: intent.client_secret, paymentIntentId: intent.id };
  }

  /**
   * Confirm (or finalise) a payment for a booking.
   *
   * - Stripe mode: confirms the existing PaymentIntent with the given
   *   payment method. Status `succeeded` → returns successful result.
   *   Other statuses raise `PaymentError` with the Stripe message.
   * - Mock mode: always succeeds with a synthetic `pay_mock_*` id.
   */
  async processPayment(
    bookingReference: string,
    paymentMethodId?: string,
  ): Promise<PaymentResult> {
    const booking = await this.adapter.getBooking(bookingReference);
    if (!booking) throw new BookingNotFoundError(bookingReference);
    if (booking.status === 'cancelled') {
      throw new PaymentError('Cannot process payment for a cancelled booking.');
    }

    if (this.stripe) {
      return this.processStripe(bookingReference, booking.totalAmount, booking.currency, paymentMethodId);
    }

    // Mock path (unchanged behavior)
    const paymentId = `pay_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    this.adapter.recordPayment(bookingReference, paymentId);
    this.store?.putPayment({
      paymentId,
      bookingReference,
      status: 'succeeded',
      amount: booking.totalAmount,
      currency: booking.currency,
      createdAt: now,
      confirmedAt: now,
    });
    return {
      paymentId,
      bookingReference,
      status: 'succeeded',
      amount: booking.totalAmount,
      currency: booking.currency,
      paidAt: now,
    };
  }

  private async processStripe(
    bookingReference: string,
    amount: string,
    currency: string,
    paymentMethodId?: string,
  ): Promise<PaymentResult> {
    if (!this.stripe) throw new Error('Stripe client not configured');
    // Find the PaymentIntent we created at booking time via the adapter.
    const booking = await this.adapter.getBooking(bookingReference);
    const intentId = (booking as { paymentIntentId?: string } | null)?.paymentIntentId;

    let intent: StripePaymentIntent;
    if (intentId) {
      intent = await this.stripe.paymentIntents.confirm(intentId, {
        ...(paymentMethodId ? { payment_method: paymentMethodId } : {}),
      });
    } else {
      // No pre-created intent — create and confirm in one step.
      const created = await this.stripe.paymentIntents.create({
        amount: toMinorUnits(amount, currency),
        currency: currency.toLowerCase(),
        metadata: { booking_reference: bookingReference },
      });
      intent = await this.stripe.paymentIntents.confirm(created.id, {
        ...(paymentMethodId ? { payment_method: paymentMethodId } : {}),
      });
    }

    if (intent.status !== 'succeeded') {
      const reason = intent.last_payment_error?.message ?? `status=${intent.status}`;
      this.store?.putPayment({
        paymentId: `pay_failed_${intent.id}`,
        bookingReference,
        status: intent.status === 'requires_action' ? 'requires_action' : 'failed',
        amount,
        currency,
        paymentIntentId: intent.id,
        createdAt: new Date().toISOString(),
        failureReason: reason,
      });
      throw new PaymentError(`Stripe payment not succeeded: ${reason}`);
    }

    const paymentId = `pay_stripe_${intent.id}`;
    const now = new Date().toISOString();
    this.adapter.recordPayment(bookingReference, paymentId, intent.id);
    this.store?.putPayment({
      paymentId,
      bookingReference,
      status: 'succeeded',
      amount,
      currency,
      paymentIntentId: intent.id,
      createdAt: now,
      confirmedAt: now,
    });

    return {
      paymentId,
      bookingReference,
      status: 'succeeded',
      amount,
      currency,
      paidAt: now,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a decimal amount string (e.g. "123.45") to the smallest currency
 * unit Stripe expects. For zero-decimal currencies (JPY, KRW, etc) we
 * pass the amount through unchanged.
 *
 * Intentionally conservative — for production use, plug in a proper
 * ISO 4217 minor-unit table via a reference agent.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

function toMinorUnits(amount: string, currency: string): number {
  const n = Number(amount);
  if (Number.isNaN(n)) throw new PaymentError(`Invalid amount: ${amount}`);
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    return Math.round(n);
  }
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BookingNotFoundError extends Error {
  constructor(reference: string) {
    super(`Booking not found: ${reference}`);
    this.name = 'BookingNotFoundError';
  }
}

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}
