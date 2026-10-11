import { describe, expect, it } from "vitest";
import { effectivePlan, planForPriceId, priceLine, providerPriceId } from "./plans";

const env = { RAZORPAY_PLAN_SOLO_MONTH: "plan_solo_m", STRIPE_PRICE_DUO_YEAR: "price_duo_y" };

describe("plans", () => {
  it("shows INR with GST separately and USD without it", () => {
    expect(priceLine("solo", "month", "INR")).toBe("₹399 + 18% GST = ₹470.82 a month");
    expect(priceLine("duo", "year", "INR")).toBe("₹5,990 + 18% GST = ₹7,068.20 a year");
    expect(priceLine("solo", "month", "USD")).toBe("$7 a month");
  });

  it("maps provider ids both ways, and an unknown id to nothing", () => {
    expect(providerPriceId("razorpay", "solo", "month", env)).toBe("plan_solo_m");
    expect(providerPriceId("stripe", "solo", "month", env)).toBeNull();
    expect(planForPriceId("stripe", "price_duo_y", env)).toEqual({ plan: "duo", interval: "year" });
    expect(planForPriceId("stripe", "price_someone_else", env)).toBeNull();
  });

  it("grants a paid plan only while active or retrying a payment", () => {
    expect(effectivePlan(null)).toBe("free");
    expect(effectivePlan({ plan: "solo", status: "active" })).toBe("solo");
    expect(effectivePlan({ plan: "solo", status: "past_due" })).toBe("solo");
    expect(effectivePlan({ plan: "duo", status: "paused" })).toBe("free");
    expect(effectivePlan({ plan: "duo", status: "cancelled" })).toBe("free");
  });
});
