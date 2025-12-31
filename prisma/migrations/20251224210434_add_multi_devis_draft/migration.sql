/*
  Warnings:

  - You are about to drop the `devis_draft` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "devis_draft";

-- CreateTable
CREATE TABLE "DevisDraft" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "titre" TEXT,
    "step" TEXT NOT NULL,
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevisDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DevisDraft_utilisateurId_status_idx" ON "DevisDraft"("utilisateurId", "status");

-- AddForeignKey
ALTER TABLE "DevisDraft" ADD CONSTRAINT "DevisDraft_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
