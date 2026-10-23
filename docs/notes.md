# Learning log

## Day 1

### Docker experiments
- 2a: An image is a read-only template (the PostgreSQL 18 program and its files). A container is a running copy of an image with its own writable layer. One postgres:18 image made two containers (db and db-test), like one class creating two objects. Deleting a container does not delete the image.
- 2b: The row survived `docker compose down` because the data is stored in the named volume `pgdata`, which lives outside the container. `docker compose down -v` also deletes volumes, so the data was gone. Containers are disposable; volumes are where data persists.
- 2c: In "5544:5432", 5544 is the port (door) on my Mac and 5432 is the port inside the container. Changing the left number only moved the door on my Mac, so the API had to use localhost:5544. Inside Docker, PostgreSQL still listened on 5432.
- 2d: The POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB values come from the .env file. Docker Compose reads .env automatically, fills in ${...} in the environment: section of docker-compose.yml, and passes them into the container. PostgreSQL uses them on first start to create the user and database. Settings and secrets stay out of the code and the image.
- Why `db:5432` and not `localhost` inside Docker: inside a container, localhost means that container itself. The API container has no database inside it. Compose puts all services on one private network where each is reachable by its service name, so the API finds the database at db:5432.

### Schema answers
1. Price and stock are facts about a (store, product) pair, not about the product. The same milk can cost different amounts and have different stock in Store A and Store B. Product details (name, unit, category) are stored once in products; per-store facts go in the store_inventory junction table. This avoids duplicating product data for every store.
2. Floating-point numbers can't represent values like 0.1 exactly (0.1 + 0.2 = 0.30000000000000004), so money calculations drift. Integers are exact. Rs 45.50 is stored as 4550 paise and converted to rupees only for display.
3. It makes negative stock impossible even if the application code has a bug. PostgreSQL rejects the update, and the transaction fails loudly instead of silently corrupting data. Constraints are the last line of defence.
4. The price paid is a historical fact. If the store raises the price next week, old orders must still show what the customer actually paid, so the price is copied at purchase time instead of looked up later.
5. The primary key is (store_id, product_id). Together the two columns identify one row: one product in one store. It also guarantees a store can't list the same product twice.

### What surprised me


### Still unclear