-- CreateTable
CREATE TABLE "ConversationState" (
    "id" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "data" JSONB,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationState_telephone_key" ON "ConversationState"("telephone");
