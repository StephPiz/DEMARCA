ALTER TABLE "inventory_movements"
ADD COLUMN "locationId" TEXT;

CREATE INDEX "inventory_movements_locationId_idx" ON "inventory_movements"("locationId");

ALTER TABLE "inventory_movements"
ADD CONSTRAINT "inventory_movements_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "warehouse_locations"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
