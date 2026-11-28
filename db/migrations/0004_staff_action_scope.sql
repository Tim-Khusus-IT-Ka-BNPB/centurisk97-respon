ALTER TABLE "staff_action" ADD COLUMN "staff_scope_level" text;--> statement-breakpoint
ALTER TABLE "staff_action" ADD COLUMN "staff_scope_code" text;--> statement-breakpoint
ALTER TABLE "staff_action" ADD CONSTRAINT "staff_action_staff_scope_level" CHECK (staff_scope_level in ('national', 'province', 'regency'));--> statement-breakpoint
ALTER TABLE "staff_action" ADD CONSTRAINT "staff_action_staff_scope" CHECK (("staff_action"."staff_scope_level" = 'national') = ("staff_action"."staff_scope_code" is null));