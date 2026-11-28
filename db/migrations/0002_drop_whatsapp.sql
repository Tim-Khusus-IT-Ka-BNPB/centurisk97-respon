ALTER TABLE "chat_session" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gateway_message" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "news_choice" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notice_delivery" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pilot_change" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pilot_number" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "chat_session" CASCADE;--> statement-breakpoint
DROP TABLE "gateway_message" CASCADE;--> statement-breakpoint
DROP TABLE "news_choice" CASCADE;--> statement-breakpoint
DROP TABLE "notice_delivery" CASCADE;--> statement-breakpoint
DROP TABLE "pilot_change" CASCADE;--> statement-breakpoint
DROP TABLE "pilot_number" CASCADE;--> statement-breakpoint
ALTER TABLE "draft_photo" DROP CONSTRAINT "draft_photo_badge";--> statement-breakpoint
ALTER TABLE "draft_photo" DROP CONSTRAINT "draft_photo_time_source";--> statement-breakpoint
ALTER TABLE "notice" DROP CONSTRAINT "notice_version";--> statement-breakpoint
ALTER TABLE "notice" DROP CONSTRAINT "notice_document";--> statement-breakpoint
ALTER TABLE "notice" DROP CONSTRAINT "notice_kind";--> statement-breakpoint
ALTER TABLE "notice" DROP CONSTRAINT "notice_history";--> statement-breakpoint
ALTER TABLE "report" DROP CONSTRAINT "report_door";--> statement-breakpoint
ALTER TABLE "staff_action" DROP CONSTRAINT "staff_action_ticket";--> statement-breakpoint
ALTER TABLE "staff_action" DROP CONSTRAINT "staff_action_action";--> statement-breakpoint
-- Rows the narrower checks refuse, and places shared in a chat, which nothing can show any more.
ALTER TABLE "staff_action" DISABLE TRIGGER "staff_action_append_only";--> statement-breakpoint
DELETE FROM "staff_action" WHERE "action" IN ('pilotAllow', 'pilotRemove');--> statement-breakpoint
ALTER TABLE "staff_action" ENABLE TRIGGER "staff_action_append_only";--> statement-breakpoint
ALTER TABLE "notice" DISABLE TRIGGER "notice_append_only";--> statement-breakpoint
DELETE FROM "notice" WHERE "kind" = 'document';--> statement-breakpoint
ALTER TABLE "notice" ENABLE TRIGGER "notice_append_only";--> statement-breakpoint
UPDATE "draft_photo" SET "time_source" = 'upload' WHERE "time_source" = 'chatMessage';--> statement-breakpoint
UPDATE "draft_photo" SET "badge" = 'none', "lat" = NULL, "lon" = NULL, "accuracy_m" = NULL WHERE "badge" = 'chatLocation';--> statement-breakpoint
UPDATE "report_draft" SET "fields" = jsonb_set("fields" #- '{place,value,point}', '{place,value,precision}', '"villageLevel"') WHERE "fields" #>> '{place,value,precision}' = 'chatLocation';--> statement-breakpoint
ALTER TABLE "report_version" DISABLE TRIGGER "report_version_append_only";--> statement-breakpoint
UPDATE "report_version" SET "fields" = jsonb_set("fields" #- '{place,value,point}', '{place,value,precision}', '"villageLevel"') WHERE "fields" #>> '{place,value,precision}' = 'chatLocation';--> statement-breakpoint
ALTER TABLE "report_version" ENABLE TRIGGER "report_version_append_only";--> statement-breakpoint
ALTER TABLE "staff_action" ALTER COLUMN "ticket_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notice" DROP COLUMN "version";--> statement-breakpoint
ALTER TABLE "report" DROP COLUMN "door";--> statement-breakpoint
ALTER TABLE "draft_photo" ADD CONSTRAINT "draft_photo_badge" CHECK (badge in ('deviceGps', 'photoData', 'none'));--> statement-breakpoint
ALTER TABLE "draft_photo" ADD CONSTRAINT "draft_photo_time_source" CHECK (time_source in ('photoData', 'deviceGps', 'upload'));--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_kind" CHECK (kind in ('status', 'reply', 'actions', 'correction'));--> statement-breakpoint
ALTER TABLE "notice" ADD CONSTRAINT "notice_history" CHECK (("notice"."kind" = 'reply') = ("notice"."history_id" is null));--> statement-breakpoint
ALTER TABLE "staff_action" ADD CONSTRAINT "staff_action_action" CHECK (action in ('view', 'identityView', 'status', 'reply', 'fieldCheck', 'handlingAction', 'handlingProof', 'take', 'document'));