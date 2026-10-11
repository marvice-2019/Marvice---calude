import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Checkout } from "@/components/Checkout";
import type { Me, Quote } from "@/shared/types";

const mockApi = jest.fn();
jest.mock("@/lib/api", () => {
  class ApiFailure extends Error {
    status: number; body: { error: string; message: string; alternatives?: unknown[] };
    constructor(s: number, b: { error: string; message: string; alternatives?: unknown[] }) { super(b.message); this.status = s; this.body = b; }
  }
  return { api: (...a: unknown[]) => mockApi(...a), ApiFailure, auth: { otp: jest.fn(), verify: jest.fn() } };
});
const mockPay = jest.fn();
jest.mock("@/lib/pay", () => ({ pay: (...a: unknown[]) => mockPay(...a) }));
const mockRemind = jest.fn(() => Promise.resolve(true));
jest.mock("@/lib/notify", () => ({ scheduleExpiryReminder: (...a: unknown[]) => (mockRemind as (...x: unknown[]) => Promise<boolean>)(...a) }));
const mockHaptic = jest.fn();
jest.mock("@/lib/feedback", () => ({ payHaptic: (...a: unknown[]) => mockHaptic(...a) }));
let mockMe: Me | null = null;
jest.mock("@/lib/useMe", () => ({ useMe: () => ({ me: mockMe, reload: jest.fn() }) }));

// ₹40/h × 2 h = ₹80, + ₹15 fee = ₹95, GST 18% = ₹17.10, total ₹112.10 (same case as the web smoke test).
const quote: Quote = { hours: 2, ratePaise: 4000, basePaise: 8000, discountPaise: 0, feePaise: 1500, gstPaise: 1710, totalPaise: 11210, promoCode: null };
const me: Me = {
  user: { id: "u1", phone: "+919845012345", full_name: null, email: null, role: "driver" },
  vehicles: [{ id: "v1", plate: "KA01AB1234", kind: "car", nickname: null }], favourites: [],
  preferences: { vehicle_id: "v1", payment_method: "upi", alerts: true, language: "en" }
};
const order = { id: "order_abc", amount: 11210, currency: "INR" as const, key_id: "rzp_test_x" };
const booking = { id: "b1", code: "BL-7Q2K", to: "2026-10-11T15:00:00Z" };
const props = { lotId: "lot1", lotName: "MG Road Metro Multilevel", initialQuote: quote, from: "2026-10-11T13:00:00Z", to: "2026-10-11T15:00:00Z", vehicle: "car", full: false };

beforeEach(() => { mockApi.mockReset(); mockPay.mockReset(); mockRemind.mockClear(); mockMe = me; });

test("signed out: shows the full bill and inline sign-in, no Pay button", async () => {
  mockMe = null;
  await render(<Checkout {...props} onPaid={jest.fn()} />);
  expect(screen.getByText("GST 18%")).toBeTruthy();
  expect(screen.getByText("₹112.10")).toBeTruthy();
  expect(screen.getByText("Sign in to book")).toBeTruthy();
  expect(screen.queryByText(/^Pay ₹/)).toBeNull();
});

test("bill shows fee and GST as separate lines and the total on the Pay button", async () => {
  await render(<Checkout {...props} onPaid={jest.fn()} />);
  expect(screen.getByText("Platform fee")).toBeTruthy();
  expect(screen.getByText("₹15")).toBeTruthy();
  expect(screen.getByText("₹17.10")).toBeTruthy();
  expect(screen.getByText("Pay ₹112.10")).toBeTruthy();
});

test("rejects a bad plate before calling the API", async () => {
  await render(<Checkout {...props} onPaid={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText("Number plate"), "KA-1");
  await fireEvent.press(screen.getByText("Pay ₹112.10"));
  expect(screen.getByTestId("checkout-error")).toHaveTextContent("Enter the number plate like KA01AB1234.");
  expect(mockApi).not.toHaveBeenCalled();
});

test("books with an idempotency key, pays, schedules the expiry reminder, then hands off", async () => {
  mockApi.mockResolvedValueOnce({ booking, quote, razorpay_order: order });
  mockPay.mockResolvedValueOnce("paid");
  const onPaid = jest.fn();
  await render(<Checkout {...props} onPaid={onPaid} />);
  await fireEvent.press(screen.getByText("Pay ₹112.10"));
  await waitFor(() => expect(onPaid).toHaveBeenCalledWith("b1"));
  expect(mockApi).toHaveBeenCalledWith("/v1/bookings", expect.objectContaining({
    method: "POST", idempotent: true, body: expect.objectContaining({ lot_id: "lot1", plate: "KA01AB1234", vehicle_kind: "car" })
  }));
  expect(mockPay).toHaveBeenCalledWith(order, expect.objectContaining({ method: "upi" }), expect.stringContaining("BL-7Q2K"));
  expect(mockRemind).toHaveBeenCalledWith(expect.objectContaining({ id: "b1", lot_name: "MG Road Metro Multilevel" }));
  expect(mockHaptic).toHaveBeenCalledWith("paid");
});

test("a closed payment sheet keeps the held bay: retry pays again without a second booking", async () => {
  mockApi.mockResolvedValueOnce({ booking, quote, razorpay_order: order });
  mockPay.mockResolvedValueOnce("cancelled").mockResolvedValueOnce("paid");
  const onPaid = jest.fn();
  await render(<Checkout {...props} onPaid={onPaid} />);
  await fireEvent.press(screen.getByText("Pay ₹112.10"));
  expect(await screen.findByTestId("checkout-error")).toHaveTextContent(/held for 10 minutes/);
  await fireEvent.press(screen.getByText("Pay ₹112.10"));
  await waitFor(() => expect(onPaid).toHaveBeenCalledWith("b1"));
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(mockPay).toHaveBeenCalledTimes(2);
});

test("a failed payment says no money was taken", async () => {
  mockApi.mockResolvedValueOnce({ booking, quote, razorpay_order: order });
  mockPay.mockResolvedValueOnce("failed");
  await render(<Checkout {...props} onPaid={jest.fn()} />);
  await fireEvent.press(screen.getByText("Pay ₹112.10"));
  expect(await screen.findByTestId("checkout-error")).toHaveTextContent(/No money was taken/);
  expect(mockHaptic).toHaveBeenCalledWith("failed");
});

test("promo code updates the bill and total", async () => {
  mockApi.mockResolvedValueOnce({ ...quote, discountPaise: 4000, promoCode: "FIRST50", gstPaise: 990, totalPaise: 6490, promo_error: null });
  await render(<Checkout {...props} onPaid={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText("Promo code"), "first50");
  await fireEvent.press(screen.getByText("Apply"));
  expect(await screen.findByText("Applied. You save ₹40.")).toBeTruthy();
  expect(screen.getByText("Promo FIRST50")).toBeTruthy();
  expect(screen.getByText("Pay ₹64.90")).toBeTruthy();
  expect(mockApi).toHaveBeenCalledWith("/v1/quotes", expect.objectContaining({ body: expect.objectContaining({ promo: "FIRST50" }) }));
});

test("lot just filled up: shows the API reason and nearby alternatives", async () => {
  const { ApiFailure } = jest.requireMock("@/lib/api");
  mockApi.mockRejectedValueOnce(new ApiFailure(409, { error: "lot_full", message: "This lot just filled up. Try a nearby lot.", alternatives: [{ id: "l2", name: "Brigade Road Basement P1", code: "BLR102" }] }));
  await render(<Checkout {...props} onPaid={jest.fn()} />);
  await fireEvent.press(screen.getByText("Pay ₹112.10"));
  expect(await screen.findByText("This lot just filled up. Try a nearby lot.")).toBeTruthy();
  expect(screen.getByText("Nearby with space: Brigade Road Basement P1")).toBeTruthy();
  expect(mockPay).not.toHaveBeenCalled();
});

test("a full lot can't be paid for", async () => {
  await render(<Checkout {...props} full onPaid={jest.fn()} />);
  expect(screen.getByRole("button", { name: "Full for these times" })).toBeDisabled();
});
