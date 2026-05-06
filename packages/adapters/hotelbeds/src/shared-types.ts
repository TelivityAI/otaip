/**
 * Cross-cutting types shared by the Activities and Transfers surfaces.
 *
 * The Hotels surface uses `string` amount fields directly (decimal precision
 * via decimal.js inside the field-mapper). Activities and Transfers expose
 * a richer canonical `Money` shape because the brief's interface includes
 * a typed `price: Money` on the public surface.
 */

export interface Money {
  /** Decimal string — never parsed to Number. */
  amount: string;
  /** ISO 4217 currency code. */
  currency: string;
}
