// The web's view of the Bayline API (../api, SPEC §5). Every response is parsed with these
// schemas, so contract drift fails loudly in the client and in the e2e suite instead of
// rendering wrong numbers. Request shapes mirror the API's zod request schemas.
// Follow-up (stage 6): move these into a shared package that the API, web and mobile all import.
import { z } from "zod";

export const VehicleKind = z.enum(["car", "bike", "ev_car", "suv"]);
export type VehicleKind = z.infer<typeof VehicleKind>;
export const PayMethod = z.enum(["upi", "card", "netbanking"]);
export type PayMethod = z.infer<typeof PayMethod>;

export const ApiError = z.object({
  error: z.string(),
  message: z.string(),
  alternatives: z.array(z.object({ id: z.string(), name: z.string(), code: z.string() })).optional()
});
export type ApiError = z.infer<typeof ApiError>;

export const Quote = z.object({
  hours: z.number().int(),
  ratePaise: z.number().int(),
  basePaise: z.number().int(),
  discountPaise: z.number().int(),
  feePaise: z.number().int(),
  gstPaise: z.number().int(),
  totalPaise: z.number().int(),
  promoCode: z.string().nullable()
});
export type Quote = z.infer<typeof Quote>;

const LotBase = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  address: z.string(),
  kind: z.string(),
  covered: z.boolean(),
  open_24h: z.boolean(),
  status: z.string().optional()
});

export const SearchRow = z.object({
  lot: LotBase.extend({ ev_chargers: z.number().int(), lat: z.number(), lng: z.number() }),
  distance_m: z.number(),
  quote: Quote,
  spots_left: z.number().int()
});
export type SearchRow = z.infer<typeof SearchRow>;
export const SearchResult = z.array(SearchRow);

export const LotDetail = z.object({
  lot: LotBase.extend({
    city: z.string(),
    ev_chargers: z.number().int(),
    opens_at: z.string().nullable(),
    closes_at: z.string().nullable(),
    capacity_car: z.number().int(),
    capacity_bike: z.number().int(),
    lat: z.number(),
    lng: z.number()
  }),
  quote: Quote,
  spots_left: z.number().int()
});
export type LotDetail = z.infer<typeof LotDetail>;

export const LotByCode = z.object({ lot: z.object({ id: z.string().uuid(), name: z.string(), code: z.string(), address: z.string(), status: z.string() }) });

export const QuoteResult = Quote.extend({ promo_error: z.string().nullable() });

export const MonthlyRow = z.object({
  lot: z.object({ id: z.string().uuid(), name: z.string(), code: z.string(), address: z.string(), kind: z.string(),
    covered: z.boolean(), open_24h: z.boolean(), opens_at: z.string().nullable(), closes_at: z.string().nullable() }),
  distance_m: z.number(),
  monthly_paise: z.number().int(),
  gst_paise: z.number().int(),
  total_paise: z.number().int()
});
export type MonthlyRow = z.infer<typeof MonthlyRow>;
export const MonthlyResult = z.array(MonthlyRow);

export const User = z.object({ id: z.string().uuid(), phone: z.string(), role: z.string(), full_name: z.string().nullable() });
export const Session = z.object({ access: z.string(), refresh: z.string(), user: User });
export type Session = z.infer<typeof Session>;
export const Refreshed = z.object({ access: z.string(), refresh: z.string() });

export const Booking = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.enum(["pending_payment", "confirmed", "checked_in", "completed", "cancelled", "no_show"]),
  source: z.string(),
  vehicle: VehicleKind,
  from: z.string(),
  to: z.string(),
  base_paise: z.number().int(),
  discount_paise: z.number().int(),
  fee_paise: z.number().int(),
  gst_paise: z.number().int(),
  total_paise: z.number().int(),
  promo_code: z.string().nullable(),
  plate: z.string(),
  lot_id: z.string().uuid(),
  lot_name: z.string(),
  lot_code: z.string(),
  phone: z.string()
});
export type Booking = z.infer<typeof Booking>;
export const Bookings = z.array(Booking);

export const GatewayOrder = z.object({ id: z.string(), amount: z.number().int(), currency: z.literal("INR"), key_id: z.string() });
export type GatewayOrder = z.infer<typeof GatewayOrder>;

export const BookingCreated = z.object({ booking: Booking, quote: Quote, razorpay_order: GatewayOrder });
export const Extended = z.object({ booking_id: z.string(), new_end: z.string(), amount_paise: z.number().int(), razorpay_order: GatewayOrder });
export const Cancelled = z.object({ booking: z.object({ id: z.string(), status: z.literal("cancelled") }),
  refund: z.object({ amount_paise: z.number().int(), message: z.string() }) });

export const Vehicle = z.object({ id: z.string().uuid(), plate: z.string(), kind: VehicleKind, nickname: z.string().nullable().optional() });
export type Vehicle = z.infer<typeof Vehicle>;
export const Me = z.object({
  user: z.object({ id: z.string(), phone: z.string(), full_name: z.string().nullable(), email: z.string().nullable(), role: z.string(),
    default_vehicle_id: z.string().nullable(), payment_method: PayMethod.nullable() }),
  vehicles: z.array(Vehicle),
  favourites: z.array(z.string()),
  preferences: z.object({ vehicle_id: z.string().nullable(), payment_method: PayMethod.nullable() })
});
export type Me = z.infer<typeof Me>;
export const VehicleCreated = z.object({ vehicle: Vehicle });
export const MonthlyRequested = z.object({ pass: z.object({ id: z.string(), status: z.string() }), message: z.string() });
export const Ok = z.object({}).passthrough();
