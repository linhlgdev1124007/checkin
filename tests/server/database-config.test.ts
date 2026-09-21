import { describe, expect, it } from 'vitest';
import { databaseConfig } from '../../src/server/data/database-config.js';

describe('databaseConfig', () => {
  it('preserves URL-special characters when credentials are supplied separately', () => {
    expect(databaseConfig({
      PGHOST: 'postgres', PGPORT: '5432', PGDATABASE: 'checkin', PGUSER: 'checkin', PGPASSWORD: 'a/b+c=',
    })).toEqual({ host: 'postgres', port: 5432, database: 'checkin', user: 'checkin', password: 'a/b+c=' });
  });
});
