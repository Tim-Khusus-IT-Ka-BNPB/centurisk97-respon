ALTER TABLE "draft_message" ADD COLUMN "text_language" text;--> statement-breakpoint
ALTER TABLE "draft_message" ADD COLUMN "text_indonesian" text;--> statement-breakpoint
ALTER TABLE "draft_message" ADD CONSTRAINT "draft_message_translation" CHECK ("draft_message"."speaker" = 'reporter' or ("draft_message"."text_language" is null and "draft_message"."text_indonesian" is null));