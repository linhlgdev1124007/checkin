import type { Pool, PoolClient } from 'pg';
import type { StateDocument } from './state-types.js';

export interface StateRepository {
  read(): Promise<StateDocument | null>;
  initialize(document: StateDocument): Promise<boolean>;
  mutate<T>(operation: (draft: StateDocument) => Promise<T> | T): Promise<T>;
  replace(document: StateDocument): Promise<void>;
}

export class MemoryStateRepository implements StateRepository {
  private document: StateDocument | null = null;
  private queue: Promise<void> = Promise.resolve();

  async read(): Promise<StateDocument | null> {
    await this.queue;
    return this.document ? structuredClone(this.document) : null;
  }

  async initialize(document: StateDocument): Promise<boolean> {
    return this.exclusive(() => {
      if (this.document) return false;
      this.document = structuredClone(document);
      return true;
    });
  }

  async mutate<T>(operation: (draft: StateDocument) => Promise<T> | T): Promise<T> {
    return this.exclusive(async () => {
      if (!this.document) throw new Error('NOT_INITIALIZED');
      const draft = structuredClone(this.document);
      const result = await operation(draft);
      this.document = draft;
      return result;
    });
  }

  async replace(document: StateDocument): Promise<void> {
    await this.exclusive(() => {
      this.document = structuredClone(document);
    });
  }

  private async exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export class PostgresStateRepository implements StateRepository {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS application_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        version BIGINT NOT NULL DEFAULT 1,
        document JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async read(): Promise<StateDocument | null> {
    const result = await this.pool.query<{ document: StateDocument }>('SELECT document FROM application_state WHERE id = 1');
    return result.rows[0]?.document ?? null;
  }

  async initialize(document: StateDocument): Promise<boolean> {
    const result = await this.pool.query(
      'INSERT INTO application_state (id, document) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
      [JSON.stringify(document)],
    );
    return result.rowCount === 1;
  }

  async mutate<T>(operation: (draft: StateDocument) => Promise<T> | T): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const document = await this.lockDocument(client);
      const draft = structuredClone(document);
      const result = await operation(draft);
      await client.query(
        'UPDATE application_state SET document = $1::jsonb, version = version + 1, updated_at = now() WHERE id = 1',
        [JSON.stringify(draft)],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async replace(document: StateDocument): Promise<void> {
    await this.pool.query(
      `INSERT INTO application_state (id, document) VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, version = application_state.version + 1, updated_at = now()`,
      [JSON.stringify(document)],
    );
  }

  private async lockDocument(client: PoolClient): Promise<StateDocument> {
    const result = await client.query<{ document: StateDocument }>('SELECT document FROM application_state WHERE id = 1 FOR UPDATE');
    if (!result.rows[0]) throw new Error('NOT_INITIALIZED');
    return result.rows[0].document;
  }
}

