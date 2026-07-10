-- 003: COGS/HPP is driven by the LATEST purchase price (per business spec),
-- not a weighted average. Store the latest purchase price per purchase unit;
-- std_cost_per_base is derived = last_purchase_price / conv_purchase_to_base.
ALTER TABLE ingredients ADD COLUMN last_purchase_price INTEGER;  -- rupiah per purchase unit (pack)
