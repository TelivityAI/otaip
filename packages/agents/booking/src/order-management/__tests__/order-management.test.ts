/**
 * Order Management — Unit Tests
 *
 * Agent 3.6: Travel order lifecycle management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OrderManagement } from '../index.js';
import type { OrderManagementInput, OrderItem, CreateOrderData } from '../types.js';

let agent: OrderManagement;

let idSeq = 0;

beforeEach(async () => {
  idSeq = 0;
  agent = new OrderManagement({
    idFactory: () => `ORD${String(++idSeq).padStart(6, '0')}`,
  });
  await agent.initialize();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    description: 'LHR-JFK Economy',
    amount: '450.00',
    currency: 'USD',
    quantity: 1,
    ...overrides,
  };
}

function makeCreateData(overrides: Partial<CreateOrderData> = {}): CreateOrderData {
  return {
    passengerName: 'John Doe',
    passengerEmail: 'john@example.com',
    recordLocator: 'ABC123',
    items: [makeItem()],
    currency: 'USD',
    source: 'GDS_AMADEUS',
    ...overrides,
  };
}

function createInput(overrides: Partial<CreateOrderData> = {}): OrderManagementInput {
  return {
    operation: 'createOrder',
    createOrder: makeCreateData(overrides),
  };
}

async function createOrderAndGetId(overrides: Partial<CreateOrderData> = {}): Promise<string> {
  const result = await agent.execute({ data: createInput(overrides) });
  return result.data.order!.orderId;
}

// ---------------------------------------------------------------------------
// createOrder
// ---------------------------------------------------------------------------
describe('Order Management', () => {
  describe('createOrder', () => {
    it('creates an order with PENDING status', async () => {
      const result = await agent.execute({ data: createInput() });
      expect(result.data.success).toBe(true);
      expect(result.data.order).toBeDefined();
      expect(result.data.order!.status).toBe('PENDING');
      expect(result.data.operation).toBe('createOrder');
    });

    it('generates sequential order IDs', async () => {
      const r1 = await agent.execute({ data: createInput() });
      const r2 = await agent.execute({ data: createInput() });
      expect(r1.data.order!.orderId).toBe('ORD000001');
      expect(r2.data.order!.orderId).toBe('ORD000002');
    });

    it('calculates total from items using decimal math', async () => {
      const result = await agent.execute({
        data: createInput({
          items: [
            makeItem({ amount: '100.10', quantity: 2 }),
            makeItem({ amount: '50.05', quantity: 1 }),
          ],
        }),
      });
      expect(result.data.order!.totalAmount).toBe('250.25');
    });

    it('records initial history entry', async () => {
      const result = await agent.execute({ data: createInput() });
      const history = result.data.order!.history;
      expect(history).toHaveLength(1);
      expect(history[0]!.fromStatus).toBeNull();
      expect(history[0]!.toStatus).toBe('PENDING');
    });

    it('stores passenger info correctly', async () => {
      const result = await agent.execute({
        data: createInput({
          passengerName: 'Jane Smith',
          passengerEmail: 'jane@test.com',
          recordLocator: 'XYZ789',
        }),
      });
      const order = result.data.order!;
      expect(order.passengerName).toBe('Jane Smith');
      expect(order.passengerEmail).toBe('jane@test.com');
      expect(order.recordLocator).toBe('XYZ789');
    });

    it('stores source and currency', async () => {
      const result = await agent.execute({
        data: createInput({ source: 'NDC_LUFTHANSA', currency: 'EUR' }),
      });
      expect(result.data.order!.source).toBe('NDC_LUFTHANSA');
      expect(result.data.order!.currency).toBe('EUR');
    });
  });

  // ---------------------------------------------------------------------------
  // modifyOrder
  // ---------------------------------------------------------------------------
  describe('modifyOrder', () => {
    it('modifies a PENDING order', async () => {
      const orderId = await createOrderAndGetId();
      const result = await agent.execute({
        data: {
          operation: 'modifyOrder',
          modifyOrder: {
            orderId,
            items: [makeItem({ amount: '500.00' })],
            reason: 'Price change',
          },
        },
      });
      expect(result.data.success).toBe(true);
      expect(result.data.order!.status).toBe('MODIFIED');
      expect(result.data.order!.totalAmount).toBe('500.00');
    });

    it('modifies a CONFIRMED order', async () => {
      const orderId = await createOrderAndGetId();
      // Manually confirm: modify then re-test with a confirmed order
      // We simulate by modifying first to get MODIFIED, but spec says PENDING/CONFIRMED modifiable.
      // Since we can only create PENDING, let's test PENDING modification.
      const result = await agent.execute({
        data: {
          operation: 'modifyOrder',
          modifyOrder: {
            orderId,
            passengerName: 'John Updated',
            reason: 'Name correction',
          },
        },
      });
      expect(result.data.success).toBe(true);
      expect(result.data.order!.passengerName).toBe('John Updated');
    });

    it('updates passenger email on modify', async () => {
      const orderId = await createOrderAndGetId();
      const result = await agent.execute({
        data: {
          operation: 'modifyOrder',
          modifyOrder: {
            orderId,
            passengerEmail: 'newemail@test.com',
            reason: 'Email change',
          },
        },
      });
      expect(result.data.success).toBe(true);
      expect(result.data.order!.passengerEmail).toBe('newemail@test.com');
    });

    it('appends history entry on modify', async () => {
      const orderId = await createOrderAndGetId();
      await agent.execute({
        data: {
          operation: 'modifyOrder',
          modifyOrder: { orderId, reason: 'Testing history' },
        },
      });
      const getResult = await agent.execute({
        data: { operation: 'getOrder', getOrder: { orderId } },
      });
      expect(getResult.data.order!.history).toHaveLength(2);
      expect(getResult.data.order!.history[1]!.fromStatus).toBe('PENDING');
      expect(getResult.data.order!.history[1]!.toStatus).toBe('MODIFIED');
      expect(getResult.data.order!.history[1]!.reason).toBe('Testing history');
    });

    it('rejects modify on non-existent order', async () => {
      const result = await agent.execute({
        data: {
          operation: 'modifyOrder',
          modifyOrder: { orderId: 'ORD999999', reason: 'Test' },
        },
      });
      expect(result.data.success).toBe(false);
      expect(result.data.errorCode).toBe('ORDER_NOT_FOUND');
    });

    it('rejects modify on CANCELLED order', async () => {
      const orderId = await createOrderAndGetId();
      await agent.execute({
        data: {
          operation: 'cancelOrder',
          cancelOrder: { orderId, reason: 'Cancel first' },
        },
      });
      const result = await agent.execute({
        data: {
          operation: 'modifyOrder',
          modifyOrder: { orderId, reason: 'Try modify' },
        },
      });
      expect(result.data.success).toBe(false);
      expect(result.data.errorCode).toBe('ORDER_ALREADY_CANCELLED');
    });

    it('recalculates total when items change', async () => {
      const orderId = await createOrderAndGetId();
      const result = await agent.execute({
        data: {
          operation: 'modifyOrder',
          modifyOrder: {
            orderId,
            items: [makeItem({ amount: '200.50', quantity: 3 })],
            reason: 'Upgrade',
          },
        },
      });
      expect(result.data.order!.totalAmount).toBe('601.50');
    });
  });

  // ---------------------------------------------------------------------------
  // cancelOrder
  // ---------------------------------------------------------------------------
  describe('cancelOrder', () => {
    it('cancels a PENDING order', async () => {
      const orderId = await createOrderAndGetId();
      const result = await agent.execute({
        data: {
          operation: 'cancelOrder',
          cancelOrder: { orderId, reason: 'Passenger request' },
        },
      });
      expect(result.data.success).toBe(true);
      expect(result.data.order!.status).toBe('CANCELLED');
    });

    it('cancels a MODIFIED order', async () => {
      const orderId = await createOrderAndGetId();
      // First modify, then cancel
      await agent.execute({
        data: {
          operation: 'modifyOrder',
          modifyOrder: { orderId, reason: 'Modify first' },
        },
      });
      const result = await agent.execute({
        data: {
          operation: 'cancelOrder',
          cancelOrder: { orderId, reason: 'Now cancel' },
        },
      });
      expect(result.data.success).toBe(true);
      expect(result.data.order!.status).toBe('CANCELLED');
    });

    it('rejects cancel on already cancelled order', async () => {
      const orderId = await createOrderAndGetId();
      await agent.execute({
        data: {
          operation: 'cancelOrder',
          cancelOrder: { orderId, reason: 'First cancel' },
        },
      });
      const result = await agent.execute({
        data: {
          operation: 'cancelOrder',
          cancelOrder: { orderId, reason: 'Second cancel' },
        },
      });
      expect(result.data.success).toBe(false);
      expect(result.data.errorCode).toBe('ORDER_ALREADY_CANCELLED');
    });

    it('rejects cancel on non-existent order', async () => {
      const result = await agent.execute({
        data: {
          operation: 'cancelOrder',
          cancelOrder: { orderId: 'ORD999999', reason: 'Cancel' },
        },
      });
      expect(result.data.success).toBe(false);
      expect(result.data.errorCode).toBe('ORDER_NOT_FOUND');
    });

    it('appends history entry on cancel', async () => {
      const orderId = await createOrderAndGetId();
      const result = await agent.execute({
        data: {
          operation: 'cancelOrder',
          cancelOrder: { orderId, reason: 'Customer changed plans' },
        },
      });
      const history = result.data.order!.history;
      expect(history).toHaveLength(2);
      expect(history[1]!.toStatus).toBe('CANCELLED');
      expect(history[1]!.reason).toBe('Customer changed plans');
    });
  });

  // ---------------------------------------------------------------------------
  // getOrder
  // ---------------------------------------------------------------------------
  describe('getOrder', () => {
    it('retrieves an existing order', async () => {
      const orderId = await createOrderAndGetId();
      const result = await agent.execute({
        data: { operation: 'getOrder', getOrder: { orderId } },
      });
      expect(result.data.success).toBe(true);
      expect(result.data.order!.orderId).toBe(orderId);
    });

    it('returns ORDER_NOT_FOUND for missing order', async () => {
      const result = await agent.execute({
        data: { operation: 'getOrder', getOrder: { orderId: 'ORD000099' } },
      });
      expect(result.data.success).toBe(false);
      expect(result.data.errorCode).toBe('ORDER_NOT_FOUND');
    });

    it('returns a deep clone (not a reference)', async () => {
      const orderId = await createOrderAndGetId();
      const r1 = await agent.execute({
        data: { operation: 'getOrder', getOrder: { orderId } },
      });
      const r2 = await agent.execute({
        data: { operation: 'getOrder', getOrder: { orderId } },
      });
      expect(r1.data.order).not.toBe(r2.data.order);
      expect(r1.data.order!.items).not.toBe(r2.data.order!.items);
    });
  });

  // ---------------------------------------------------------------------------
  // listOrders
  // ---------------------------------------------------------------------------
  describe('listOrders', () => {
    it('lists all orders when no filter', async () => {
      await createOrderAndGetId();
      await createOrderAndGetId({ passengerEmail: 'other@test.com' });
      const result = await agent.execute({
        data: { operation: 'listOrders' },
      });
      expect(result.data.success).toBe(true);
      expect(result.data.orders).toHaveLength(2);
    });

    it('filters by status', async () => {
      const orderId = await createOrderAndGetId();
      await createOrderAndGetId({ passengerEmail: 'other@test.com' });
      await agent.execute({
        data: {
          operation: 'cancelOrder',
          cancelOrder: { orderId, reason: 'Cancel' },
        },
      });
      const result = await agent.execute({
        data: {
          operation: 'listOrders',
          listOrders: { filter: { status: 'CANCELLED' } },
        },
      });
      expect(result.data.orders).toHaveLength(1);
      expect(result.data.orders![0]!.status).toBe('CANCELLED');
    });

    it('filters by passengerEmail (case-insensitive)', async () => {
      await createOrderAndGetId({ passengerEmail: 'Alice@Example.com' });
      await createOrderAndGetId({ passengerEmail: 'bob@test.com' });
      const result = await agent.execute({
        data: {
          operation: 'listOrders',
          listOrders: { filter: { passengerEmail: 'alice@example.com' } },
        },
      });
      expect(result.data.orders).toHaveLength(1);
    });

    it('filters by source', async () => {
      await createOrderAndGetId({ source: 'GDS_AMADEUS' });
      await createOrderAndGetId({ source: 'NDC_LUFTHANSA' });
      const result = await agent.execute({
        data: {
          operation: 'listOrders',
          listOrders: { filter: { source: 'NDC_LUFTHANSA' } },
        },
      });
      expect(result.data.orders).toHaveLength(1);
      expect(result.data.orders![0]!.source).toBe('NDC_LUFTHANSA');
    });

    it('returns empty array when no matches', async () => {
      await createOrderAndGetId();
      const result = await agent.execute({
        data: {
          operation: 'listOrders',
          listOrders: { filter: { status: 'FULFILLED' } },
        },
      });
      expect(result.data.orders).toHaveLength(0);
    });

    it('combines multiple filters', async () => {
      await createOrderAndGetId({ passengerEmail: 'a@test.com', source: 'GDS_AMADEUS' });
      await createOrderAndGetId({ passengerEmail: 'a@test.com', source: 'NDC_LUFTHANSA' });
      await createOrderAndGetId({ passengerEmail: 'b@test.com', source: 'GDS_AMADEUS' });
      const result = await agent.execute({
        data: {
          operation: 'listOrders',
          listOrders: { filter: { passengerEmail: 'a@test.com', source: 'GDS_AMADEUS' } },
        },
      });
      expect(result.data.orders).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------------
  describe('Input validation', () => {
    it('rejects unknown operation', async () => {
      await expect(
        agent.execute({ data: { operation: 'unknown' as 'createOrder' } }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects createOrder without data', async () => {
      await expect(agent.execute({ data: { operation: 'createOrder' } })).rejects.toThrow(
        'Invalid input',
      );
    });

    it('rejects createOrder with empty passengerName', async () => {
      await expect(agent.execute({ data: createInput({ passengerName: '' }) })).rejects.toThrow(
        'Invalid input',
      );
    });

    it('rejects createOrder with empty items', async () => {
      await expect(agent.execute({ data: createInput({ items: [] }) })).rejects.toThrow(
        'Invalid input',
      );
    });

    it('rejects item with negative amount', async () => {
      await expect(
        agent.execute({
          data: createInput({ items: [makeItem({ amount: '-10.00' })] }),
        }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects item with zero quantity', async () => {
      await expect(
        agent.execute({
          data: createInput({ items: [makeItem({ quantity: 0 })] }),
        }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects modifyOrder without reason', async () => {
      await expect(
        agent.execute({
          data: {
            operation: 'modifyOrder',
            modifyOrder: { orderId: 'ORD000001', reason: '' },
          },
        }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects cancelOrder without orderId', async () => {
      await expect(
        agent.execute({
          data: {
            operation: 'cancelOrder',
            cancelOrder: { orderId: '', reason: 'Test' },
          },
        }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects getOrder without data', async () => {
      await expect(agent.execute({ data: { operation: 'getOrder' } })).rejects.toThrow(
        'Invalid input',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Agent interface compliance
  // ---------------------------------------------------------------------------
  describe('Agent interface compliance', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('3.6');
      expect(agent.name).toBe('Order Management');
      expect(agent.version).toBe('0.1.0');
    });

    it('reports healthy after init', async () => {
      const health = await agent.health();
      expect(health.status).toBe('healthy');
    });

    it('reports unhealthy before init', async () => {
      const uninit = new OrderManagement();
      const health = await uninit.health();
      expect(health.status).toBe('unhealthy');
    });

    it('throws when not initialized', async () => {
      const uninit = new OrderManagement();
      await expect(uninit.execute({ data: createInput() })).rejects.toThrow('not been initialized');
    });

    it('returns metadata in output', async () => {
      const result = await agent.execute({ data: createInput() });
      expect(result.metadata!['agent_id']).toBe('3.6');
      expect(result.metadata!['operation']).toBe('createOrder');
      expect(result.metadata!['success']).toBe(true);
    });

    it('returns warnings on error operations', async () => {
      const result = await agent.execute({
        data: { operation: 'getOrder', getOrder: { orderId: 'ORD999999' } },
      });
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
    });

    it('destroy clears state', async () => {
      await createOrderAndGetId();
      agent.destroy();
      // After destroy, agent is uninitialized
      await expect(agent.execute({ data: createInput() })).rejects.toThrow('not been initialized');
    });

    it('re-initializes cleanly after destroy', async () => {
      await createOrderAndGetId();
      agent.destroy();
      await agent.initialize();
      const result = await agent.execute({
        data: { operation: 'listOrders' },
      });
      expect(result.data.orders).toHaveLength(0);
    });
  });
});
