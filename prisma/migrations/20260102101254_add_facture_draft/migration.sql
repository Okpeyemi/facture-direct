-- CreateTable
CREATE TABLE "FactureDraft" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactureDraft_utilisateurId_status_idx" ON "FactureDraft"("utilisateurId", "status");

-- AddForeignKey
ALTER TABLE "FactureDraft" ADD CONSTRAINT "FactureDraft_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
