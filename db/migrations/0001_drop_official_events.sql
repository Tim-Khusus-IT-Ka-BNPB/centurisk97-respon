ALTER TABLE "reference_file" DROP CONSTRAINT "reference_file_name";--> statement-breakpoint
DELETE FROM "reference_file" WHERE "name" = 'officialEvents';--> statement-breakpoint
ALTER TABLE "reference_file" ADD CONSTRAINT "reference_file_name" CHECK (name in ('bpbdContacts', 'education', 'responseActions', 'forecast', 'volcanoes', 'facilityNumbers'));