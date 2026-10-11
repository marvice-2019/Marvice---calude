// Response and request shapes of the Bayline API (parking-app/SPEC.md §5, parking-app/api/src/routes).
// Kept in one place; scripts/smoke.mjs checks them against the live API so drift fails loudly.

export type VehicleKind = "car" | "bike" | "ev_car" | "suv";
export type FilterId = "covered" | "ev" | "valet" | "h24" | "bike" | "saved";

export type Quote = {
  hours: number; ratePaise: number; basePaise: number; discountPaise: number;
  feePaise: number; gstPaise: number; totalPaise: number; promoCode: string | null; promo_error?: string | null;
};

export type LotSummary = {
  id: string; name: string; code: string; address: string; kind: string; covered: boolean;
  ev_chargers: number; open_24h: boolean; status: "open" | "full" | "gate_down" | "closed"; valet?: boolean;
  lat?: number; lng?: number; // present in search results (map pins)
};
export type SearchRow = { lot: LotSummary; distance_m: number; quote: Quote; spots_left: number };
export type LotDetail = LotSummary & { city: string; capacity_car: number; capacity_bike: number; lat: number; lng: number; opens_at: string | null; closes_at: string | null };
export type LotDetailResponse = { lot: LotDetail; quote: Quote; spots_left: number };

export type Destination = { name: string; kind: string; lat: number; lng: number };

export type RazorpayOrder = { id: string; amount: number; currency: "INR"; key_id: string };
export type Booking = {
  id: string; code: string; status: string; source: "prebook" | "park_now"; vehicle: VehicleKind;
  from: string; to: string; base_paise: number; discount_paise: number; fee_paise: number; gst_paise: number; total_paise: number;
  promo_code: string | null; plate: string; lot_id: string; lot_name: string; lot_code: string; phone: string;
  spot: { floor: string | null; bay: string | null; note: string | null; photo_url: string | null } | null;
};
export type CreateBookingResponse = { booking: Booking; quote: Quote; razorpay_order: RazorpayOrder };

export type ValetDesk = { id: string; name: string; fee_paise: number; gst_paise: number; typical_eta_min: number; distance_m: number; validator: string | null };
export type ValetTicket = {
  id: string; code: string; status: "dropped" | "parked" | "requested" | "coming" | "ready" | "closed" | "cancelled";
  key_tag: string; bay: string | null; handover_photos: string[]; fee_paise: number; gst_paise: number; tip_paise: number;
  dropped_at: string; requested_at: string | null; ready_at: string | null; closed_at: string | null; validated: boolean;
  desk_id: string; desk_name: string; typical_eta_min: number; plate: string; phone: string; eta_at: string | null;
};
export type ValetRequestResponse = { ticket: ValetTicket; bill?: { fee_paise: number; gst_paise: number; tip_paise: number; total_paise: number }; razorpay_order: RazorpayOrder | null };

export type Me = {
  user: { id: string; phone: string; full_name: string | null; email: string | null; role: string };
  vehicles: { id: string; plate: string; kind: VehicleKind; nickname: string | null }[];
  favourites: string[];
  preferences: { vehicle_id: string | null; payment_method: string | null; alerts: boolean; language: "en" | "kn" | "hi" };
};

export type ApiError = { error: string; message: string; alternatives?: { id: string; name: string; code: string }[] };
