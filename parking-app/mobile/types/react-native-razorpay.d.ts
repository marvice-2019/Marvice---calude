// react-native-razorpay ships without types. Only the call this app makes is declared.
declare module "react-native-razorpay" {
  export type CheckoutOptions = {
    key: string; order_id: string; amount: number; currency: string; name: string; description?: string;
    prefill?: { contact?: string; email?: string; name?: string; method?: string }; theme?: { color?: string };
  };
  export type CheckoutSuccess = { razorpay_payment_id: string; razorpay_order_id?: string; razorpay_signature?: string };
  const RazorpayCheckout: { open(options: CheckoutOptions): Promise<CheckoutSuccess> };
  export default RazorpayCheckout;
}
