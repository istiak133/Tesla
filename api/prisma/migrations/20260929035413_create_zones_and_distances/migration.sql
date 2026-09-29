-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_distances" (
    "from_zone_id" UUID NOT NULL,
    "to_zone_id" UUID NOT NULL,
    "km" INTEGER NOT NULL,

    CONSTRAINT "zone_distances_pkey" PRIMARY KEY ("from_zone_id","to_zone_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zones_code_key" ON "zones"("code");

-- CreateIndex
CREATE UNIQUE INDEX "zones_name_key" ON "zones"("name");

-- AddForeignKey
ALTER TABLE "zone_distances" ADD CONSTRAINT "zone_distances_from_zone_id_fkey" FOREIGN KEY ("from_zone_id") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_distances" ADD CONSTRAINT "zone_distances_to_zone_id_fkey" FOREIGN KEY ("to_zone_id") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: Prisma schema cannot express CHECK constraints (see docs/erd.md).
ALTER TABLE "zone_distances" ADD CONSTRAINT "zone_distances_positive_km" CHECK ("km" > 0);
ALTER TABLE "zone_distances" ADD CONSTRAINT "zone_distances_different_zones" CHECK ("from_zone_id" <> "to_zone_id");
