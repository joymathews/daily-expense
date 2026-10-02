FROM postgres:16-alpine

# Set default timezone
ENV TZ=UTC

# Copy automated initial schema if provided
COPY init-db.sql /docker-entrypoint-initdb.d/init-db.sql
