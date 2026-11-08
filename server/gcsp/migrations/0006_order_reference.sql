-- FUCQ-220: each selection order carries its own generated reference, unique per run where present.
CREATE UNIQUE INDEX "pending_operations_order_reference_unique" ON "pending_operations" ("run_id", (data->>'orderReference')) WHERE data->>'orderReference' IS NOT NULL;
