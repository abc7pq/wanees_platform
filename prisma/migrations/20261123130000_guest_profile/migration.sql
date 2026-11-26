-- GuestProfile: ملف ضيف مجهول دائم (توكن hashed فقط، بلا بيانات شخصية)
CREATE TABLE "GuestProfile" (
    "id" TEXT NOT NULL,
    "publicTokenHash" TEXT NOT NULL,
    "displayName" TEXT,
    "preferences" JSONB,
    "affinityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visitedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GuestProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuestProfile_publicTokenHash_key" ON "GuestProfile"("publicTokenHash");

-- ربط الجلسات بملف الضيف: حذف الملف يترك الجلسات سليمة بلا ربط
ALTER TABLE "VisitorSession" ADD COLUMN "guestProfileId" TEXT;
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_guestProfileId_fkey" FOREIGN KEY ("guestProfileId") REFERENCES "GuestProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "VisitorSession_guestProfileId_idx" ON "VisitorSession"("guestProfileId");
