ALTER TABLE "fx_rates"
ADD COLUMN "createdByUserId" TEXT;

CREATE INDEX "fx_rates_createdByUserId_idx" ON "fx_rates"("createdByUserId");

ALTER TABLE "fx_rates"
ADD CONSTRAINT "fx_rates_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
