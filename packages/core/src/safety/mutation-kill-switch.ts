/**
 * MutationKillSwitch — stop new irreversible / money-path mutations.
 */

export class MutationKillSwitch {
  private blocked = false;
  private reason: string | null = null;

  /** Block all new mutations. */
  engage(reason = 'manual'): void {
    this.blocked = true;
    this.reason = reason;
  }

  /** Allow mutations again. */
  release(): void {
    this.blocked = false;
    this.reason = null;
  }

  get isEngaged(): boolean {
    return this.blocked;
  }

  get engagedReason(): string | null {
    return this.reason;
  }

  /** Throws if the kill switch is engaged. */
  assertMutationsAllowed(): void {
    if (this.blocked) {
      throw new MutationKillSwitchError(
        `Mutation kill switch engaged: ${this.reason ?? 'unspecified'}`,
      );
    }
  }
}

export class MutationKillSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutationKillSwitchError';
  }
}
