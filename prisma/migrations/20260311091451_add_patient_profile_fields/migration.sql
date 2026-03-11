-- AlterTable
ALTER TABLE "PatientProfile" ADD COLUMN "birthDate" TIMESTAMP(3),
ADD COLUMN "weight" TEXT,
ADD COLUMN "gender" TEXT,
ADD COLUMN "familyHistory" TEXT,
ADD COLUMN "medications" TEXT,
ADD COLUMN "caregiverProfession" TEXT;

