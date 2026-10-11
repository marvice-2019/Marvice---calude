-- Sample data for local development and the web end-to-end tests. Never load into production.
-- Lot names describe locations only; operator and prices are illustrative (same as the prototype).
BEGIN;
INSERT INTO operators (id, legal_name, pan) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Sample Parking Operator Pvt Ltd', 'ABCDE1234F')
ON CONFLICT DO NOTHING;

INSERT INTO lots (id, operator_id, name, address, city, geo, kind, capacity_car, capacity_bike, online_share,
                  covered, ev_chargers, open_24h, opens_at, closes_at, is_live, code)
SELECT v.id::uuid, '00000000-0000-4000-8000-000000000001', v.name, v.address, 'Bengaluru',
       ST_MakePoint(v.lng, v.lat)::geography, v.kind::lot_kind, v.cap, v.bikes, 0.5,
       v.covered, v.ev, v.h24, v.opens::time, v.closes::time, true, v.code
FROM (VALUES
  ('10000000-0000-4000-8000-000000000101', 'BLR101', 'MG Road Metro Multilevel',   'MG Road, near Metro exit B',        12.9757, 77.6066, 'multilevel',   280, 60, true,  4, false, '06:00', '23:30'),
  ('10000000-0000-4000-8000-000000000102', 'BLR102', 'Brigade Road Basement P1',   'Brigade Road, basement level P1',   12.9716, 77.6070, 'basement',     350, 80, true,  0, true,  NULL,    NULL),
  ('10000000-0000-4000-8000-000000000103', 'BLR103', '100 Feet Road Open Lot',     '100 Feet Road, Indiranagar',        12.9719, 77.6412, 'surface',      220, 50, false, 0, false, '08:00', '23:00'),
  ('10000000-0000-4000-8000-000000000104', 'BLR104', 'Koramangala 5th Block Deck', '5th Block, Koramangala',            12.9346, 77.6189, 'covered_deck', 200, 40, true,  2, true,  NULL,    NULL),
  ('10000000-0000-4000-8000-000000000105', 'BLR105', 'HSR Sector 2 Apartment Bays','Sector 2, HSR Layout',              12.9121, 77.6446, 'owner_listed', 180, 30, true,  0, false, '09:00', '20:00'),
  ('10000000-0000-4000-8000-000000000106', 'BLR106', 'ITPL Main Road Gate 3',      'ITPL Main Road, Whitefield',        12.9852, 77.7361, 'surface',      220, 60, false, 6, true,  NULL,    NULL),
  ('10000000-0000-4000-8000-000000000107', 'BLR107', 'Manyata Visitor Deck',       'Manyata Tech Park, Hebbal',         13.0475, 77.6215, 'multilevel',   300, 70, true,  3, false, '07:00', '22:00'),
  ('10000000-0000-4000-8000-000000000108', 'BLR108', 'Airport Long-Stay P4',       'Kempegowda International Airport', 13.1950, 77.7050, 'surface',      450, 90, false, 8, true,  NULL,    NULL)
) AS v(id, code, name, address, lat, lng, kind, cap, bikes, covered, ev, h24, opens, closes)
ON CONFLICT DO NOTHING;

INSERT INTO lot_rates (lot_id, vehicle, hourly_paise, monthly_paise, valid)
SELECT l.id, r.vehicle::vehicle_kind, r.hourly, r.monthly, tstzrange('-infinity', NULL)
FROM (VALUES
  ('BLR101','car',4000,420000),('BLR101','bike',1500,NULL),
  ('BLR102','car',5000,500000),('BLR102','bike',2000,NULL),
  ('BLR103','car',3500,350000),('BLR103','bike',1000,NULL),
  ('BLR104','car',3000,320000),('BLR104','bike',1000,NULL),
  ('BLR105','car',2500,260000),('BLR105','bike',1000,NULL),
  ('BLR106','car',3000,300000),('BLR106','bike',1000,NULL),
  ('BLR107','car',4000,380000),('BLR107','bike',1500,NULL),
  ('BLR108','car',6000,NULL),  ('BLR108','bike',2500,NULL)
) AS r(code, vehicle, hourly, monthly)
JOIN lots l ON l.code = r.code
WHERE NOT EXISTS (SELECT 1 FROM lot_rates x WHERE x.lot_id = l.id AND x.vehicle = r.vehicle::vehicle_kind);

INSERT INTO promo_codes (code, percent_off, max_off_paise, first_booking_only, weekend_only, valid) VALUES
  ('FIRST50',   50, 10000, true,  false, tstzrange('-infinity', NULL)),
  ('WEEKEND20', 20, 20000, false, true,  tstzrange('-infinity', NULL))
ON CONFLICT DO NOTHING;
COMMIT;
