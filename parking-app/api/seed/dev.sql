-- Dev/demo seed: Bengaluru sample lots. Operators, names and prices are INVENTED samples, not real businesses.
-- Coordinates are approximate public landmarks. Never run against production.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/dev.sql   (after migrations; safe to re-run)
BEGIN;
INSERT INTO operators (id, legal_name, pan) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Sample Ring Road Parking Pvt Ltd', 'AAAPS1234A'),
  ('00000000-0000-4000-8000-000000000002', 'Sample Lakeview Parking LLP', 'AAAPL5678B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO lots (id, operator_id, name, address, city, geo, kind, capacity_car, capacity_bike, online_share, covered, ev_chargers, open_24h, opens_at, closes_at, is_live, code) VALUES
  ('10000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','MG Road Metro Multilevel','Next to MG Road Metro, MG Road','Bengaluru',ST_MakePoint(77.6066,12.9757)::geography,'multilevel',220,80,0.6,true,4,true,null,null,true,'BLR101'),
  ('10000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','Brigade Road Basement P1','Brigade Road, off MG Road','Bengaluru',ST_MakePoint(77.6070,12.9716)::geography,'basement',90,40,0.5,true,0,false,'08:00','23:30',true,'BLR102'),
  ('10000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000002','UB City Valet Deck','Vittal Mallya Road','Bengaluru',ST_MakePoint(77.5960,12.9716)::geography,'covered_deck',140,20,0.5,true,2,false,'09:00','01:00',true,'BLR103'),
  ('10000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000002','Chinnaswamy Gate 2 Surface','Queens Road, near Gate 2','Bengaluru',ST_MakePoint(77.5996,12.9788)::geography,'surface',160,120,0.7,false,0,false,'07:00','23:00',true,'BLR104'),
  ('10000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000001','Indiranagar 100 ft Road Deck','100 Feet Road, HAL 2nd Stage','Bengaluru',ST_MakePoint(77.6408,12.9784)::geography,'covered_deck',70,50,0.5,true,2,false,'08:00','00:30',true,'BLR105'),
  ('10000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000002','Forum Koramangala Basement','Hosur Road, Koramangala','Bengaluru',ST_MakePoint(77.6112,12.9345)::geography,'basement',300,150,0.5,true,6,true,null,null,true,'BLR106'),
  ('10000000-0000-4000-8000-000000000107','00000000-0000-4000-8000-000000000001','Koramangala 5th Block Surface','80 Feet Road, 5th Block','Bengaluru',ST_MakePoint(77.6245,12.9352)::geography,'surface',45,60,0.6,false,0,false,'07:00','23:00',true,'BLR107'),
  ('10000000-0000-4000-8000-000000000108','00000000-0000-4000-8000-000000000002','Phoenix Whitefield P2','Whitefield Main Road','Bengaluru',ST_MakePoint(77.6966,12.9976)::geography,'multilevel',500,200,0.5,true,8,true,null,null,true,'BLR108')
ON CONFLICT (id) DO NOTHING;

INSERT INTO lot_rates (lot_id, vehicle, hourly_paise, monthly_paise, valid)
SELECT l.id, v.kind::vehicle_kind, (r.car * v.mult)::int, CASE WHEN v.kind = 'car' THEN r.car * 105 END, tstzrange('-infinity', NULL)
FROM lots l
JOIN (VALUES ('BLR101',4000),('BLR102',5000),('BLR103',8000),('BLR104',3000),('BLR105',4500),('BLR106',6000),('BLR107',3000),('BLR108',5000)) r(code, car) ON r.code = l.code
CROSS JOIN (VALUES ('car',1.0),('suv',1.25),('ev_car',1.0),('bike',0.375)) v(kind, mult)
WHERE NOT EXISTS (SELECT 1 FROM lot_rates x WHERE x.lot_id = l.id AND x.vehicle = v.kind::vehicle_kind);

INSERT INTO valet_desks (id, operator_id, lot_id, name, geo, fee_paise, typical_eta_min, is_live) VALUES
  ('20000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000103','UB City main porch',ST_MakePoint(77.5962,12.9718)::geography,15000,6,true),
  ('20000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000106','Forum Koramangala entrance',ST_MakePoint(77.6110,12.9347)::geography,10000,8,true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO valet_validations (desk_id, validator, code, valid) VALUES
  ('20000000-0000-4000-8000-000000000201','Sample Bistro (UB City)','DINE24',tstzrange(now() - interval '1 day', now() + interval '365 days'))
ON CONFLICT DO NOTHING;

INSERT INTO promo_codes (code, percent_off, max_off_paise, first_booking_only, valid)
VALUES ('FIRST50',50,10000,true,tstzrange('-infinity',NULL)) ON CONFLICT DO NOTHING;
INSERT INTO promo_codes (code, percent_off, max_off_paise, weekend_only, valid)
VALUES ('WEEKEND20',20,20000,true,tstzrange('-infinity',NULL)) ON CONFLICT DO NOTHING;
COMMIT;
