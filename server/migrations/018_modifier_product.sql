-- 018: Link a modifier to a menu product so selling the modifier deducts that
-- product's recipe from inventory (Option A). Example: the "Extra Shot"
-- modifier points at the "Extra Shot Espresso" product (16g beans + 50ml water);
-- attaching it to a line and checking out now consumes those ingredients.
--
-- product_id is nullable: a modifier without one stays price-only (like before),
-- so existing modifiers keep working unchanged. price_delta remains the manual
-- selling surcharge; the linked product's recipe is used only for stock/COGS,
-- never to set the price.
ALTER TABLE modifiers ADD COLUMN product_id INTEGER REFERENCES products(id);
