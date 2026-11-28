ALTER TABLE "ticket" ADD COLUMN "assigned_area" text;--> statement-breakpoint
-- A ticket sent before assignment belongs to the BPBD of its report's regency.
UPDATE "ticket" SET "assigned_area" = "report"."regency_code" FROM "report" WHERE "report"."id" = "ticket"."report_id";--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "assigned_area" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "triage_tier" text DEFAULT 'sedang' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "triage_score" integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "triage_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "ticket_assigned" ON "ticket" USING btree ("assigned_area");--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assigned_area" CHECK (assigned_area ~ '^[0-9]{2}(\.[0-9]{2})?$');--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_triage_tier" CHECK (triage_tier in ('darurat', 'tinggi', 'sedang', 'rendah'));--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_triage_score" CHECK ("ticket"."triage_score" between 0 and 100);