/**
 * Live mode refuses mutations on raw Connect adapters (must use createAdapter).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { LiveSafetyError } from '@otaip/core';
import { SabreAdapter } from '../suppliers/sabre/index.js';
import { createAdapter } from '../suppliers/index.js';

afterEach(() => {
  delete process.env['OTAIP_MODE'];
});

describe('live refuse raw Connect adapters', () => {
  it('new SabreAdapter createBooking throws LiveSafetyError in live mode', async () => {
    process.env['OTAIP_MODE'] = 'live';
    const adapter = new SabreAdapter({
      clientId: 'id',
      clientSecret: 'secret',
      environment: 'cert',
    });

    await expect(
      adapter.createBooking({
        offerId: 'o1',
        passengers: [
          {
            type: 'adult',
            gender: 'M',
            firstName: 'A',
            lastName: 'B',
            dateOfBirth: '1990-01-01',
          },
        ],
        contact: { email: 'a@b.com', phone: '+1' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toBeInstanceOf(LiveSafetyError);
  });

  it('createAdapter live path marks adapter — does not refuse at construction', () => {
    process.env['OTAIP_MODE'] = 'live';
    expect(() =>
      createAdapter(
        'sabre',
        { clientId: 'id', clientSecret: 'secret', environment: 'cert' },
        { liveMode: true },
      ),
    ).not.toThrow();
  });
});
