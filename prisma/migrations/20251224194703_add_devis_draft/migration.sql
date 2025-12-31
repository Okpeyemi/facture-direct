-- CreateTable
CREATE TABLE "DevisDraft" (
    "id" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "data" JSONB,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevisDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevisDraft_telephone_key" ON "DevisDraft"("telephone");
