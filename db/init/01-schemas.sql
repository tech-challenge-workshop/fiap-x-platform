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

-- Roles are cluster-wide, not per-database, so a plain CREATE ROLE fails the
-- moment this script is applied to a second database in the same cluster.
-- The deliverable has to be applicable to an empty database, not only an
-- empty cluster.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog') THEN
    CREATE ROLE catalog LOGIN PASSWORD 'catalog';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification') THEN
    CREATE ROLE notification LOGIN PASSWORD 'notification';
  END IF;
END
$$;

-- Each role owns its schema outright, so its migrations can create tables.
ALTER SCHEMA catalog OWNER TO catalog;
ALTER SCHEMA notification OWNER TO notification;

-- current_database() rather than a literal: the deliverable must work in
-- whatever database it is applied to.
DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO catalog, notification',
    current_database()
  );
END
$$;

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
