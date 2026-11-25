export interface Waba {
  id: string;
  meta_waba_id: string;
  name: string | null;
  numbers: { id: string; displayPhone: string; verifiedName: string | null; metaPhoneNumberId: string; qualityRating: string | null }[];
}
