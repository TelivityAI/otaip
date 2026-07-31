/**
 * Order Management — Agent 3.6
 *
 * Travel order lifecycle management — create, modify, cancel, retrieve,
 * and list orders with status tracking and transition validation.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import { randomUUID } from 'node:crypto';
import type {
  Agent,
  AgentInput,
  AgentOutput,
  AgentHealthStatus,
  PersistenceAdapter,
} from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import Decimal from 'decimal.js';
import type {
  OrderManagementInput,
  OrderManagementOutput,
  Order,
  OrderItem,
  OrderStatus,
  OrderHistoryEntry,
  CreateOrderData,
  ModifyOrderData,
  CancelOrderData,
  GetOrderData,
  ListOrdersData,
} from './types.js';

const VALID_OPERATIONS = new Set([
  'createOrder',
  'modifyOrder',
  'cancelOrder',
  'getOrder',
  'listOrders',
]);

const MODIFIABLE_STATUSES: ReadonlySet<OrderStatus> = new Set(['PENDING', 'CONFIRMED']);
const CANCELLABLE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'PENDING',
  'CONFIRMED',
  'MODIFIED',
]);

const ORDER_KEY_PREFIX = 'order:';

export interface OrderManagementConfig {
  /** Optional persistence adapter. When omitted the agent uses an in-memory Map. */
  persistence?: PersistenceAdapter;
}

export class OrderManagement implements Agent<OrderManagementInput, OrderManagementOutput> {
  readonly id = '3.6';
  readonly name = 'Order Management';
  readonly version = '0.1.0';

  private initialized = false;
  private orders: Map<string, Order> = new Map();
  private readonly persistence: PersistenceAdapter | undefined;
  private readonly idFactory: () => string;

  constructor(config?: OrderManagementConfig & { idFactory?: () => string }) {
    this.persistence = config?.persistence;
    this.idFactory = config?.idFactory ?? ((): string => `ORD-${randomUUID()}`);
  }

  async initialize(): Promise<void> {
    this.orders.clear();
    this.initialized = true;
  }

  async execute(
    input: AgentInput<OrderManagementInput>,
  ): Promise<AgentOutput<OrderManagementOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const { operation } = input.data;
    let result: OrderManagementOutput;

    switch (operation) {
      case 'createOrder':
        result = await this.handleCreate(input.data.createOrder!);
        break;
      case 'modifyOrder':
        result = await this.handleModify(input.data.modifyOrder!);
        break;
      case 'cancelOrder':
        result = await this.handleCancel(input.data.cancelOrder!);
        break;
      case 'getOrder':
        result = await this.handleGet(input.data.getOrder!);
        break;
      case 'listOrders':
        result = await this.handleList(input.data.listOrders ?? {});
        break;
      default:
        throw new AgentInputValidationError(this.id, 'operation', 'Unknown operation.');
    }

    const warnings: string[] = [];
    if (!result.success && result.errorMessage) {
      warnings.push(result.errorMessage);
    }

    const orderCount = this.persistence
      ? (await this.persistence.list(ORDER_KEY_PREFIX)).length
      : this.orders.size;

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        operation,
        success: result.success,
        order_count: orderCount,
      },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) {
      return { status: 'unhealthy', details: 'Not initialized. Call initialize() first.' };
    }
    return { status: 'healthy' };
  }

  destroy(): void {
    this.orders.clear();
    this.initialized = false;
  }

  // ---------------------------------------------------------------------------
  // Storage helpers — delegate to PersistenceAdapter when provided
  // ---------------------------------------------------------------------------

  private async storeGet(orderId: string): Promise<Order | null> {
    if (this.persistence) {
      return this.persistence.get<Order>(`${ORDER_KEY_PREFIX}${orderId}`);
    }
    return this.orders.get(orderId) ?? null;
  }

  private async storeSet(order: Order): Promise<void> {
    if (this.persistence) {
      await this.persistence.set<Order>(`${ORDER_KEY_PREFIX}${order.orderId}`, order);
    } else {
      this.orders.set(order.orderId, order);
    }
  }

  private async storeListAll(): Promise<Order[]> {
    if (this.persistence) {
      const keys = await this.persistence.list(ORDER_KEY_PREFIX);
      const orders: Order[] = [];
      for (const key of keys) {
        const order = await this.persistence.get<Order>(key);
        if (order) orders.push(order);
      }
      return orders;
    }
    return Array.from(this.orders.values());
  }

  // ---------------------------------------------------------------------------
  // Operation handlers
  // ---------------------------------------------------------------------------

  private async handleCreate(data: CreateOrderData): Promise<OrderManagementOutput> {
    const orderId = this.idFactory();
    const now = new Date().toISOString();

    const totalAmount = data.items
      .reduce(
        (sum, item) => sum.plus(new Decimal(item.amount).times(item.quantity)),
        new Decimal(0),
      )
      .toFixed(2);

    const initialHistory: OrderHistoryEntry = {
      timestamp: now,
      fromStatus: null,
      toStatus: 'PENDING',
      reason: 'Order created',
    };

    const order: Order = {
      orderId,
      status: 'PENDING',
      passengerName: data.passengerName,
      passengerEmail: data.passengerEmail,
      recordLocator: data.recordLocator,
      items: [...data.items],
      totalAmount,
      currency: data.currency,
      source: data.source,
      history: [initialHistory],
      createdAt: now,
      updatedAt: now,
    };

    await this.storeSet(order);

    return { order: this.cloneOrder(order), operation: 'createOrder', success: true };
  }

  private async handleModify(data: ModifyOrderData): Promise<OrderManagementOutput> {
    const order = await this.storeGet(data.orderId);
    if (!order) {
      return {
        operation: 'modifyOrder',
        success: false,
        errorCode: 'ORDER_NOT_FOUND',
        errorMessage: `Order ${data.orderId} not found.`,
      };
    }

    if (order.status === 'FULFILLED') {
      return {
        operation: 'modifyOrder',
        success: false,
        errorCode: 'ORDER_ALREADY_FULFILLED',
        errorMessage: `Order ${data.orderId} is already fulfilled and cannot be modified.`,
      };
    }

    if (order.status === 'CANCELLED') {
      return {
        operation: 'modifyOrder',
        success: false,
        errorCode: 'ORDER_ALREADY_CANCELLED',
        errorMessage: `Order ${data.orderId} is already cancelled and cannot be modified.`,
      };
    }

    if (!MODIFIABLE_STATUSES.has(order.status)) {
      return {
        operation: 'modifyOrder',
        success: false,
        errorCode: 'INVALID_STATUS_TRANSITION',
        errorMessage: `Cannot modify order in status ${order.status}.`,
      };
    }

    const now = new Date().toISOString();
    const previousStatus = order.status;

    if (data.items) {
      order.items = [...data.items];
      order.totalAmount = data.items
        .reduce(
          (sum, item) => sum.plus(new Decimal(item.amount).times(item.quantity)),
          new Decimal(0),
        )
        .toFixed(2);
    }
    if (data.passengerName) {
      order.passengerName = data.passengerName;
    }
    if (data.passengerEmail) {
      order.passengerEmail = data.passengerEmail;
    }

    order.status = 'MODIFIED';
    order.updatedAt = now;
    order.history.push({
      timestamp: now,
      fromStatus: previousStatus,
      toStatus: 'MODIFIED',
      reason: data.reason,
    });

    await this.storeSet(order);

    return { order: this.cloneOrder(order), operation: 'modifyOrder', success: true };
  }

  private async handleCancel(data: CancelOrderData): Promise<OrderManagementOutput> {
    const order = await this.storeGet(data.orderId);
    if (!order) {
      return {
        operation: 'cancelOrder',
        success: false,
        errorCode: 'ORDER_NOT_FOUND',
        errorMessage: `Order ${data.orderId} not found.`,
      };
    }

    if (order.status === 'FULFILLED') {
      return {
        operation: 'cancelOrder',
        success: false,
        errorCode: 'ORDER_ALREADY_FULFILLED',
        errorMessage: `Order ${data.orderId} is already fulfilled and cannot be cancelled.`,
      };
    }

    if (order.status === 'CANCELLED') {
      return {
        operation: 'cancelOrder',
        success: false,
        errorCode: 'ORDER_ALREADY_CANCELLED',
        errorMessage: `Order ${data.orderId} is already cancelled.`,
      };
    }

    if (!CANCELLABLE_STATUSES.has(order.status)) {
      return {
        operation: 'cancelOrder',
        success: false,
        errorCode: 'INVALID_STATUS_TRANSITION',
        errorMessage: `Cannot cancel order in status ${order.status}.`,
      };
    }

    const now = new Date().toISOString();
    const previousStatus = order.status;

    order.status = 'CANCELLED';
    order.updatedAt = now;
    order.history.push({
      timestamp: now,
      fromStatus: previousStatus,
      toStatus: 'CANCELLED',
      reason: data.reason,
    });

    await this.storeSet(order);

    return { order: this.cloneOrder(order), operation: 'cancelOrder', success: true };
  }

  private async handleGet(data: GetOrderData): Promise<OrderManagementOutput> {
    const order = await this.storeGet(data.orderId);
    if (!order) {
      return {
        operation: 'getOrder',
        success: false,
        errorCode: 'ORDER_NOT_FOUND',
        errorMessage: `Order ${data.orderId} not found.`,
      };
    }
    return { order: this.cloneOrder(order), operation: 'getOrder', success: true };
  }

  private async handleList(data: ListOrdersData): Promise<OrderManagementOutput> {
    let orders = await this.storeListAll();

    if (data.filter) {
      if (data.filter.status) {
        orders = orders.filter((o) => o.status === data.filter!.status);
      }
      if (data.filter.passengerEmail) {
        orders = orders.filter(
          (o) => o.passengerEmail.toLowerCase() === data.filter!.passengerEmail!.toLowerCase(),
        );
      }
      if (data.filter.source) {
        orders = orders.filter((o) => o.source === data.filter!.source);
      }
    }

    return {
      orders: orders.map((o) => this.cloneOrder(o)),
      operation: 'listOrders',
      success: true,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private cloneOrder(order: Order): Order {
    return {
      ...order,
      items: order.items.map((i) => ({ ...i })),
      history: order.history.map((h) => ({ ...h })),
    };
  }

  private validateInput(data: OrderManagementInput): void {
    if (!data.operation || !VALID_OPERATIONS.has(data.operation)) {
      throw new AgentInputValidationError(
        this.id,
        'operation',
        `Must be one of: ${[...VALID_OPERATIONS].join(', ')}`,
      );
    }

    switch (data.operation) {
      case 'createOrder':
        this.validateCreateOrder(data.createOrder);
        break;
      case 'modifyOrder':
        this.validateModifyOrder(data.modifyOrder);
        break;
      case 'cancelOrder':
        this.validateCancelOrder(data.cancelOrder);
        break;
      case 'getOrder':
        this.validateGetOrder(data.getOrder);
        break;
      case 'listOrders':
        // listOrders has no required fields
        break;
    }
  }

  private validateCreateOrder(data: CreateOrderData | undefined): void {
    if (!data) {
      throw new AgentInputValidationError(
        this.id,
        'createOrder',
        'createOrder data is required for createOrder operation.',
      );
    }
    if (!data.passengerName || data.passengerName.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'passengerName', 'Passenger name is required.');
    }
    if (!data.passengerEmail || data.passengerEmail.trim().length === 0) {
      throw new AgentInputValidationError(
        this.id,
        'passengerEmail',
        'Passenger email is required.',
      );
    }
    if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
      throw new AgentInputValidationError(this.id, 'items', 'At least one order item is required.');
    }
    for (const item of data.items) {
      this.validateOrderItem(item);
    }
    if (!data.currency || data.currency.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'currency', 'Currency is required.');
    }
    if (!data.source || data.source.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'source', 'Source is required.');
    }
  }

  private validateOrderItem(item: OrderItem): void {
    if (!item.description || item.description.trim().length === 0) {
      throw new AgentInputValidationError(
        this.id,
        'item.description',
        'Item description is required.',
      );
    }
    if (!item.amount) {
      throw new AgentInputValidationError(this.id, 'item.amount', 'Item amount is required.');
    }
    try {
      const d = new Decimal(item.amount);
      if (d.isNegative()) {
        throw new AgentInputValidationError(
          this.id,
          'item.amount',
          'Item amount must be non-negative.',
        );
      }
    } catch {
      throw new AgentInputValidationError(
        this.id,
        'item.amount',
        'Item amount must be a valid decimal number.',
      );
    }
    if (!item.currency || item.currency.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'item.currency', 'Item currency is required.');
    }
    if (item.quantity == null || item.quantity < 1) {
      throw new AgentInputValidationError(
        this.id,
        'item.quantity',
        'Item quantity must be at least 1.',
      );
    }
  }

  private validateModifyOrder(data: ModifyOrderData | undefined): void {
    if (!data) {
      throw new AgentInputValidationError(
        this.id,
        'modifyOrder',
        'modifyOrder data is required for modifyOrder operation.',
      );
    }
    if (!data.orderId || data.orderId.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'orderId', 'Order ID is required.');
    }
    if (!data.reason || data.reason.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'reason', 'Modification reason is required.');
    }
    if (data.items) {
      if (!Array.isArray(data.items) || data.items.length === 0) {
        throw new AgentInputValidationError(
          this.id,
          'items',
          'Items array must not be empty when provided.',
        );
      }
      for (const item of data.items) {
        this.validateOrderItem(item);
      }
    }
  }

  private validateCancelOrder(data: CancelOrderData | undefined): void {
    if (!data) {
      throw new AgentInputValidationError(
        this.id,
        'cancelOrder',
        'cancelOrder data is required for cancelOrder operation.',
      );
    }
    if (!data.orderId || data.orderId.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'orderId', 'Order ID is required.');
    }
    if (!data.reason || data.reason.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'reason', 'Cancellation reason is required.');
    }
  }

  private validateGetOrder(data: GetOrderData | undefined): void {
    if (!data) {
      throw new AgentInputValidationError(
        this.id,
        'getOrder',
        'getOrder data is required for getOrder operation.',
      );
    }
    if (!data.orderId || data.orderId.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'orderId', 'Order ID is required.');
    }
  }
}

export type {
  OrderManagementInput,
  OrderManagementOutput,
  Order,
  OrderItem,
  OrderStatus,
  OrderOperationType,
  OrderErrorCode,
  OrderHistoryEntry,
  CreateOrderData,
  ModifyOrderData,
  CancelOrderData,
  GetOrderData,
  ListOrdersData,
  ListOrdersFilter,
} from './types.js';
