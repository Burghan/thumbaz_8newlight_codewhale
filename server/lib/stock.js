// Stock deduction utility — shared by sales and import routes.
// When a product is sold, deduct its recipe ingredients from inventory.
const db = require('../db');

function deductStockForSale(transactionId, items) {
  // items: [{ product_id, quantity }]
  const results = { deducted: 0, skipped: 0, insufficient: 0 };

  const getRecipe = db.prepare(`
    SELECT ingredient_id, quantity as recipe_qty, i.name as ing_name, i.base_unit
    FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id
    WHERE r.product_id = ?
  `);

  const deductInv = db.prepare(`
    UPDATE inventory SET quantity_base = MAX(0, quantity_base - ?),
      updated_at = datetime('now') WHERE ingredient_id = ?
  `);

  const addMovement = db.prepare(`
    INSERT INTO stock_movements (ingredient_id, type, qty_base, ref_type, ref_id, note)
    VALUES (?, 'usage', ?, 'sale', ?, ?)
  `);

  const checkStock = db.prepare(`
    SELECT quantity_base FROM inventory WHERE ingredient_id = ?
  `);

  for (const item of items) {
    const productId = item.product_id;
    const saleQty = Number(item.quantity) || 1;

    // Get recipe ingredients for this product
    const recipeLines = getRecipe.all(productId);

    if (recipeLines.length === 0) {
      // No recipe — resale item or unlinked product, skip
      results.skipped += saleQty;
      continue;
    }

    for (const line of recipeLines) {
      const amountToDeduct = line.recipe_qty * saleQty;
      const currentStock = checkStock.get(line.ingredient_id);

      if (!currentStock || currentStock.quantity_base < amountToDeduct) {
        results.insufficient++;
        // Still deduct what we can
        deductInv.run(amountToDeduct, line.ingredient_id);
      } else {
        deductInv.run(amountToDeduct, line.ingredient_id);
      }

      addMovement.run(
        line.ingredient_id,
        -amountToDeduct,
        transactionId,
        `Sale #${transactionId}: -${amountToDeduct.toFixed(2)} ${line.base_unit} of ${line.ing_name}`
      );

      results.deducted++;
    }
  }

  return results;
}

module.exports = { deductStockForSale };
