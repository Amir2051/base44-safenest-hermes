"""Apply all current SafeNestT staging-only schemas in one explicit transaction."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

import asyncpg

from .migrate_auth import validate_database_name


async def main() -> None:
    dsn = os.getenv("DATABASE_URL", "").strip()
    app_env = os.getenv("APP_ENV", "").strip()
    if not dsn:
        raise RuntimeError("DATABASE_URL is required")
    conn = await asyncpg.connect(dsn)
    try:
        database_name = await conn.fetchval("SELECT current_database()")
        validate_database_name(database_name, app_env)
        root = Path(__file__).parent
        async with conn.transaction():
            for filename in ("auth_schema.sql", "cases_schema.sql"):
                await conn.execute((root / filename).read_text(encoding="utf-8"))
        print(f"Applied auth and owner-scoped case schemas to approved staging database: {database_name}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
