ALTER TABLE "staff_action" DROP CONSTRAINT "staff_action_action";--> statement-breakpoint
ALTER TABLE "ticket_history" DROP CONSTRAINT "ticket_history_event";--> statement-breakpoint
ALTER TABLE "staff_action" ADD CONSTRAINT "staff_action_action" CHECK (action in ('view', 'identityView', 'status', 'reply', 'fieldCheck', 'handlingAction', 'handlingProof', 'take', 'document', 'trackingLink', 'assign'));--> statement-breakpoint
ALTER TABLE "ticket_history" ADD CONSTRAINT "ticket_history_event" CHECK (event in ('fieldCheck', 'actions', 'take', 'followUp', 'released', 'commentFigure', 'assigned'));