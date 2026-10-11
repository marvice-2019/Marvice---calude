// Why the system released a booking that was waiting on payment. Shared by the store, the payment code and the pages,
// so every page explains a failed payment the same way.

export const PAYMENT_NOT_COMPLETED = "Payment not completed";
export const PAYMENT_COULD_NOT_START = "Payment could not start";

/** A hold released because the guest's payment never completed or never started: not a cancellation anyone chose. */
export function isUnpaidRelease(reason: string | null | undefined): boolean {
  return reason === PAYMENT_NOT_COMPLETED || reason === PAYMENT_COULD_NOT_START;
}
