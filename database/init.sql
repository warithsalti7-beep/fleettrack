-- FleetTrack Database Initialization
-- This file runs once when the PostgreSQL container is first created.
-- The actual schema is managed by Prisma migrations (backend/prisma/migrations/).

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for trigram text search on driver/vehicle names
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- for exclusion constraints

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE fleettrack TO fleettrack;

-- Set timezone
SET timezone = 'UTC';
