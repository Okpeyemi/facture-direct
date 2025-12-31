/*
  Warnings:

  - You are about to drop the `DevisDraft` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "DevisDraft";

-- CreateTable
CREATE TABLE "devis_draft" (
    "id" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "data" JSONB,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devis_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devis_draft_telephone_key" ON "devis_draft"("telephone");
