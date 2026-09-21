-- Bootstrap for the local topology.
--
-- RUNS ONLY ONCE, on an empty data volume. The PostgreSQL image executes
-- everything in /docker-entrypoint-initdb.d the first time it initialises a
-- data directory and never again. A developer whose volume predates this file
-- will see the services fail to reach their schema; the fix is
-- `docker compose down -v`. See the README.
--
-- This is bootstrap, not migration. Each service owns and evolves its own
-- tables through its own migrations; this file only creates the empty rooms
-- and locks the doors between them.

-- One schema and one role per owning service. The foundation forbids a service
-- reading another's tables, and a grant is the only form of that rule which
-- survives someone in a hurry.

CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS notification;

CREATE ROLE catalog LOGIN PASSWORD 'catalog';
CREATE ROLE notification LOGIN PASSWORD 'notification';

-- Each role owns its schema outright, so its migrations can create tables.
ALTER SCHEMA catalog OWNER TO catalog;
ALTER SCHEMA notification OWNER TO notification;

GRANT CONNECT ON DATABASE fiapx TO catalog, notification;

-- Neither role may see the other's schema. PUBLIC is revoked first, because
-- otherwise every role would inherit access to anything created later.
REVOKE ALL ON SCHEMA catalog FROM PUBLIC;
REVOKE ALL ON SCHEMA notification FROM PUBLIC;

GRANT USAGE, CREATE ON SCHEMA catalog TO catalog;
GRANT USAGE, CREATE ON SCHEMA notification TO notification;

-- A role's default search path points at its own schema, so a migration that
-- omits the qualifier still lands in the right place.
ALTER ROLE catalog SET search_path TO catalog;
ALTER ROLE notification SET search_path TO notification;
