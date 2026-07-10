-- 006: resale toggle — products bought finished (no recipe, e.g. Mineral Water, Croissant).
-- HPP/COGS comes from the linked "shadow ingredient" which stores the buying price.
ALTER TABLE products ADD COLUMN is_resale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN resale_ingredient_id INTEGER REFERENCES ingredients(id);
