-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'EDITOR', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'LIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CatalogVersionStatus" AS ENUM ('DRAFT', 'VALIDATING', 'PUBLISHED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('ACTIVE', 'TEMPORARILY_CLOSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('ENTRANCE', 'ZONE', 'ACTIVITY', 'LANDMARK', 'SERVICE');

-- CreateEnum
CREATE TYPE "CrowdSource" AS ENUM ('SIMULATED', 'OPERATOR', 'SENSOR', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "EventUpdateType" AS ENUM ('CLOSURE', 'DELAY', 'SCHEDULE_CHANGE', 'CROWD_OVERRIDE', 'CONTENT_CORRECTION');

-- CreateEnum
CREATE TYPE "AssistantResultType" AS ENUM ('ANSWER', 'TOOL_RESULT', 'CLARIFICATION', 'HANDOFF', 'ABSTAINED', 'ERROR');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "externalAuthSubject" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "address" TEXT,
    "mapAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "venueId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "defaultLocale" TEXT NOT NULL DEFAULT 'ar-SA',
    "publishedCatalogVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogVersion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "CatalogVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceSummary" TEXT,
    "validationReport" JSONB,
    "createdById" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "mapX" DOUBLE PRECISION NOT NULL,
    "mapY" DOUBLE PRECISION NOT NULL,
    "capacity" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ActivityStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "descriptionAr" TEXT,
    "descriptionEn" TEXT,
    "type" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "priceMinCents" INTEGER,
    "priceMaxCents" INTEGER,
    "ageMin" INTEGER,
    "ageMax" INTEGER,
    "familyFriendly" BOOLEAN NOT NULL DEFAULT false,
    "walkingLevel" TEXT NOT NULL DEFAULT 'medium',
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accessibilityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "popularityWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ActivityStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "dayOfWeek" INTEGER,
    "eventDate" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,
    "bookingRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteNode" (
    "id" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "zoneId" TEXT,
    "stableKey" TEXT NOT NULL,
    "type" "NodeType" NOT NULL,
    "label" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "accessible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RouteNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteEdge" (
    "id" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "walkMin" INTEGER NOT NULL,
    "accessible" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'open',

    CONSTRAINT "RouteEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentSource" (
    "id" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "locator" TEXT,
    "checksum" TEXT,
    "observedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "trustLevel" TEXT NOT NULL DEFAULT 'operator_verified',

    CONSTRAINT "ContentSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventUpdate" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "updateType" "EventUpdateType" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "payload" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrowdSnapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "level" DOUBLE PRECISION NOT NULL,
    "source" "CrowdSource" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "CrowdSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorSession" (
    "id" TEXT NOT NULL,
    "publicTokenHash" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar-SA',
    "entryPoint" TEXT,
    "consentState" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorPreference" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "companions" TEXT,
    "mood" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budgetMaxCents" INTEGER,
    "availableMinutes" INTEGER,
    "walkingTolerance" TEXT,
    "startPointId" TEXT,
    "optInPersist" BOOLEAN NOT NULL DEFAULT false,
    "retentionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Itinerary" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "catalogVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "generatedReason" TEXT,
    "totalCostCents" INTEGER NOT NULL DEFAULT 0,
    "totalWalkMin" INTEGER NOT NULL DEFAULT 0,
    "totalWaitMin" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Itinerary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItineraryItem" (
    "id" TEXT NOT NULL,
    "itineraryId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "walkMin" INTEGER NOT NULL DEFAULT 0,
    "waitMin" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" TEXT NOT NULL DEFAULT 'planned',

    CONSTRAINT "ItineraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "toolName" TEXT,
    "resultType" "AssistantResultType" NOT NULL,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "redactedContent" TEXT,
    "retentionExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" DOUBLE PRECISION NOT NULL,
    "zoneId" TEXT,
    "activityId" TEXT,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeSummary" JSONB,
    "afterSummary" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "checksum" TEXT,
    "sizeBytes" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalAuthSubject_key" ON "User"("externalAuthSubject");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Venue_organizationId_idx" ON "Venue"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_organizationId_slug_key" ON "Venue"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Event_publishedCatalogVersionId_key" ON "Event"("publishedCatalogVersionId");

-- CreateIndex
CREATE INDEX "Event_organizationId_status_idx" ON "Event"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Event_organizationId_slug_key" ON "Event"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "CatalogVersion_eventId_status_idx" ON "CatalogVersion"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogVersion_eventId_versionNumber_key" ON "CatalogVersion"("eventId", "versionNumber");

-- CreateIndex
CREATE INDEX "Zone_catalogVersionId_idx" ON "Zone"("catalogVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_catalogVersionId_stableKey_key" ON "Zone"("catalogVersionId", "stableKey");

-- CreateIndex
CREATE INDEX "Activity_catalogVersionId_zoneId_idx" ON "Activity"("catalogVersionId", "zoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_catalogVersionId_stableKey_key" ON "Activity"("catalogVersionId", "stableKey");

-- CreateIndex
CREATE INDEX "Schedule_activityId_startsAt_endsAt_idx" ON "Schedule"("activityId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "RouteNode_catalogVersionId_type_idx" ON "RouteNode"("catalogVersionId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "RouteNode_catalogVersionId_stableKey_key" ON "RouteNode"("catalogVersionId", "stableKey");

-- CreateIndex
CREATE INDEX "RouteEdge_fromNodeId_idx" ON "RouteEdge"("fromNodeId");

-- CreateIndex
CREATE INDEX "RouteEdge_toNodeId_idx" ON "RouteEdge"("toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "RouteEdge_catalogVersionId_fromNodeId_toNodeId_key" ON "RouteEdge"("catalogVersionId", "fromNodeId", "toNodeId");

-- CreateIndex
CREATE INDEX "ContentSource_catalogVersionId_idx" ON "ContentSource"("catalogVersionId");

-- CreateIndex
CREATE INDEX "EventUpdate_eventId_createdAt_idx" ON "EventUpdate"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "CrowdSnapshot_eventId_zoneId_observedAt_idx" ON "CrowdSnapshot"("eventId", "zoneId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorSession_publicTokenHash_key" ON "VisitorSession"("publicTokenHash");

-- CreateIndex
CREATE INDEX "VisitorSession_eventId_expiresAt_idx" ON "VisitorSession"("eventId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorPreference_sessionId_key" ON "VisitorPreference"("sessionId");

-- CreateIndex
CREATE INDEX "Itinerary_sessionId_generatedAt_idx" ON "Itinerary"("sessionId", "generatedAt");

-- CreateIndex
CREATE INDEX "Itinerary_eventId_generatedAt_idx" ON "Itinerary"("eventId", "generatedAt");

-- CreateIndex
CREATE INDEX "ItineraryItem_activityId_idx" ON "ItineraryItem"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ItineraryItem_itineraryId_sequence_key" ON "ItineraryItem"("itineraryId", "sequence");

-- CreateIndex
CREATE INDEX "AssistantEvent_eventId_createdAt_idx" ON "AssistantEvent"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationTurn_sessionId_createdAt_idx" ON "ConversationTurn"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventId_metricName_bucketStart_idx" ON "AnalyticsEvent"("eventId", "metricName", "bucketStart");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_organizationId_idx" ON "Asset"("organizationId");

-- CreateIndex
CREATE INDEX "Asset_eventId_idx" ON "Asset"("eventId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_publishedCatalogVersionId_fkey" FOREIGN KEY ("publishedCatalogVersionId") REFERENCES "CatalogVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogVersion" ADD CONSTRAINT "CatalogVersion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogVersion" ADD CONSTRAINT "CatalogVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogVersion" ADD CONSTRAINT "CatalogVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "CatalogVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "CatalogVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteNode" ADD CONSTRAINT "RouteNode_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "CatalogVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteNode" ADD CONSTRAINT "RouteNode_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteEdge" ADD CONSTRAINT "RouteEdge_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "CatalogVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteEdge" ADD CONSTRAINT "RouteEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "RouteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteEdge" ADD CONSTRAINT "RouteEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "RouteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentSource" ADD CONSTRAINT "ContentSource_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "CatalogVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventUpdate" ADD CONSTRAINT "EventUpdate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventUpdate" ADD CONSTRAINT "EventUpdate_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrowdSnapshot" ADD CONSTRAINT "CrowdSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrowdSnapshot" ADD CONSTRAINT "CrowdSnapshot_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "CatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorPreference" ADD CONSTRAINT "VisitorPreference_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Itinerary" ADD CONSTRAINT "Itinerary_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "CatalogVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_itineraryId_fkey" FOREIGN KEY ("itineraryId") REFERENCES "Itinerary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItineraryItem" ADD CONSTRAINT "ItineraryItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantEvent" ADD CONSTRAINT "AssistantEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantEvent" ADD CONSTRAINT "AssistantEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
