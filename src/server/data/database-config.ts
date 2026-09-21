import type { PoolConfig } from 'pg';

export function databaseConfig(environment: NodeJS.ProcessEnv): PoolConfig {
  if (environment.DATABASE_URL) return { connectionString: environment.DATABASE_URL };
  const required = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const;
  for (const name of required) {
    if (!environment[name]) throw new Error(`${name} is required when DATABASE_URL is not set`);
  }
  const port = Number(environment.PGPORT ?? 5432);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error('PGPORT must be a valid port');
  return {
    host: environment.PGHOST,
    port,
    database: environment.PGDATABASE,
    user: environment.PGUSER,
    password: environment.PGPASSWORD,
  };
}
