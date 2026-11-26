-- 013_commerce.sql — product catalog and orders (WhatsApp carts, manual and API orders).

CREATE TABLE products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  retailer_id  text NOT NULL CHECK (length(retailer_id) BETWEEN 1 AND 100),   -- SKU; must match "Content ID" in the Meta catalog
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description  text CHECK (length(description) <= 5000),
  price_paise  bigint NOT NULL CHECK (price_paise >= 0),
  currency     text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  image_url    text CHECK (image_url ~ '^https://'),
  stock        integer CHECK (stock >= 0),                                    -- NULL = not tracked
  is_active    boolean NOT NULL DEFAULT true,
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','shopify')),
  external_id  text,                                                          -- Shopify variant id
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, retailer_id)
);

CREATE TABLE order_counters (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_no    integer NOT NULL DEFAULT 1000
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number           integer NOT NULL,
  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','paid','shipped','delivered','cancelled')),
  items            jsonb NOT NULL,      -- [{retailerId, productId, name, quantity, unitPaise, totalPaise}]
  subtotal_paise   bigint NOT NULL CHECK (subtotal_paise >= 0),
  currency         text NOT NULL DEFAULT 'INR',
  note             text CHECK (length(note) <= 2000),
  source           text NOT NULL CHECK (source IN ('whatsapp','manual','api')),
  wa_message_id    text,
  catalog_id       text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, wa_message_id)
);
CREATE INDEX orders_list_idx ON orders (tenant_id, created_at DESC);
CREATE INDEX orders_contact_idx ON orders (tenant_id, contact_id);

CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['products','order_counters','orders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I
                    USING (tenant_id = app_current_tenant())
                    WITH CHECK (tenant_id = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;
