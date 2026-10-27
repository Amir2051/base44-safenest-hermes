"""Apply only the isolated custom-auth schema to a dedicated staging database.

This is deliberately an explicit one-shot command, never an application startup hook.
It refuses the known SafeNestT production/test database names and only permits a
purpose-named migration/staging database. It does not migrate case or evidence data.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg

PROTECTED_DATABASES = {"safenestt_ai", "safenestt_ai_test"}
ALLOWED_PREFIXES = ("safenestt_migration_", "safenestt_staging_")


def validate_database_name(database_name: str, app_env: str) -> None:
    normalized = database_name.strip().lower()
    if normalized in PROTECTED_DATABASES:
        raise RuntimeError("Refusing to apply custom-auth schema to a protected SafeNestT database")
    if app_env.strip().lower() not in {"staging", "migration"}:
        raise RuntimeError("AUTH schema migration is permitted only when APP_ENV=staging or migration")
    if not normalized.startswith(ALLOWED_PREFIXES):
        raise RuntimeError("Refusing migration: database name must start with safenestt_migration_ or safenestt_staging_")


async def main() -> None:
    dsn = os.getenv("DATABASE_URL", "").strip()
    app_env = os.getenv("APP_ENV", "").strip()
    if not dsn:
        raise RuntimeError("DATABASE_URL is required")

    conn = await asyncpg.connect(dsn)
    try:
        database_name = await conn.fetchval("SELECT current_database()")
        validate_database_name(database_name, app_env)
        schema = Path(__file__).with_name("auth_schema.sql").read_text(encoding="utf-8")
        async with conn.transaction():
            await conn.execute(schema)
        print(f"Applied isolated custom-auth schema to approved staging database: {database_name}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
