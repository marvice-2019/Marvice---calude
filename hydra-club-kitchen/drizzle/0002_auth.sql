CREATE TABLE "rate_limit_hits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rate_limit_hits_key_at_idx" ON "rate_limit_hits" USING btree ("key","at");--> statement-breakpoint
CREATE INDEX "rate_limit_hits_at_idx" ON "rate_limit_hits" USING btree ("at");