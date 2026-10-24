# db/init

PostgreSQL runs files from this folder only when its data volume is brand new.
The schema no longer lives here: it is created by **migrations** in `api/migrations/`,
which the API applies when it starts (or run `cd api && npm run migrate`).

To change the schema, add a new numbered file such as `api/migrations/0005_add_x.sql`.
