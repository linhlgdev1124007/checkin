import { randomUUID } from 'node:crypto';

export class Vault {
  private dataKey: Buffer | null = null;
  readonly bootId: string;

  constructor(bootId: string = randomUUID()) {
    this.bootId = bootId;
  }

  get unlocked(): boolean {
    return this.dataKey !== null;
  }

  unlock(key: Buffer): void {
    this.lock();
    this.dataKey = Buffer.from(key);
  }

  requireKey(): Buffer {
    if (!this.dataKey) throw new Error('SYSTEM_LOCKED');
    return Buffer.from(this.dataKey);
  }

  lock(): void {
    this.dataKey?.fill(0);
    this.dataKey = null;
  }
}
