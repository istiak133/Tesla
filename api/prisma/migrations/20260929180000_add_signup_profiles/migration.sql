-- Sign-up details for both kinds of user (D-015): contact details on users, identity and
-- licence on driver_profiles, and the plate on vehicles. Old rows keep nulls.


-- CreateEnum
CREATE TYPE "IdDocumentType" AS ENUM ('NID', 'PASSPORT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "permanent_address" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "present_address" TEXT;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "plate_number" TEXT;

-- CreateTable
CREATE TABLE "driver_profiles" (
    "user_id" UUID NOT NULL,
    "id_type" "IdDocumentType" NOT NULL,
    "id_number" TEXT NOT NULL,
    "licence_number" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_licence_number_key" ON "driver_profiles"("licence_number");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_id_type_id_number_key" ON "driver_profiles"("id_type", "id_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "vehicles"("plate_number");

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: the database refuses badly formed values even if the app has a bug (D-015).
-- Phones are stored normalised: +880 1[3-9] and eight more digits.
ALTER TABLE "users" ADD CONSTRAINT "users_phone_format"
  CHECK ("phone" IS NULL OR "phone" ~ '^\+8801[3-9][0-9]{8}$');

-- NID: 10 (smart card), 13 or 17 digits. Passport: one or two capital letters and 7–8 digits.
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_id_number_format"
  CHECK (
    ("id_type" = 'NID' AND "id_number" ~ '^([0-9]{10}|[0-9]{13}|[0-9]{17})$')
    OR ("id_type" = 'PASSPORT' AND "id_number" ~ '^[A-Z]{1,2}[0-9]{7,8}$')
  );

-- Licence and plate numbers are stored in capitals without spaces at the ends.
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_licence_upper"
  CHECK ("licence_number" = upper(btrim("licence_number")));
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_plate_upper"
  CHECK ("plate_number" IS NULL OR "plate_number" = upper(btrim("plate_number")));
