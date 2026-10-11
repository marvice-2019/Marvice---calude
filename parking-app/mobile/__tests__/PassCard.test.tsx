import { fireEvent, render, screen } from "@testing-library/react-native";
import { PassCard } from "@/components/PassCard";
import type { Booking } from "@/shared/types";

jest.mock("react-native-qrcode-svg", () => {
  const { Text } = jest.requireActual("react-native");
  return { __esModule: true, default: ({ value }: { value: string }) => <Text testID="qr-value">{value}</Text> };
});

const H = 3_600_000;
const NOW = Date.parse("2026-10-11T12:00:00Z");
const base: Booking = {
  id: "b1", code: "BL-7Q2K", status: "confirmed", source: "prebook", vehicle: "car",
  from: new Date(NOW - H).toISOString(), to: new Date(NOW + H).toISOString(),
  base_paise: 8000, discount_paise: 0, fee_paise: 1500, gst_paise: 1710, total_paise: 11210, promo_code: null,
  plate: "KA01AB1234", lot_id: "l1", lot_name: "MG Road Metro Multilevel", lot_code: "BLR101", phone: "+919845012345", spot: null
};

test("live pass: QR encodes the booking code, shows time left and the +1 hour action", async () => {
  const onExtend = jest.fn();
  await render(<PassCard b={base} now={NOW} onExtend={onExtend} onSpot={jest.fn()} onCancel={jest.fn()} />);
  expect(screen.getByTestId("qr-value")).toHaveTextContent("BL-7Q2K");
  expect(screen.getByLabelText("Gate QR for pass BL-7Q2K")).toBeTruthy();
  expect(screen.getByText("Parked · 1 h 0 min left")).toBeTruthy();
  expect(screen.getByLabelText("50% of your time used")).toBeTruthy();
  await fireEvent.press(screen.getByText("+1 hour"));
  expect(onExtend).toHaveBeenCalled();
});

test("shows what was paid with GST and the lot code without the city prefix", async () => {
  await render(<PassCard b={base} now={NOW} />);
  expect(screen.getByText("₹112.10 (GST ₹17.10)")).toBeTruthy();
  expect(screen.getByText("101")).toBeTruthy();
  expect(screen.getByText("KA01AB1234")).toBeTruthy();
});

test("offline: the pass still renders, actions are hidden with a reason", async () => {
  await render(<PassCard b={base} now={NOW} offline onExtend={jest.fn()} onCancel={jest.fn()} onSpot={jest.fn()} />);
  expect(screen.getByTestId("qr-value")).toHaveTextContent("BL-7Q2K");
  expect(screen.getByText("Saved pass. Extend and cancel need a connection.")).toBeTruthy();
  expect(screen.queryByText("+1 hour")).toBeNull();
});

test("cancel is offered only more than an hour before arrival", async () => {
  const later = { ...base, from: new Date(NOW + 3 * H).toISOString(), to: new Date(NOW + 5 * H).toISOString() };
  await render(<PassCard b={later} now={NOW} onCancel={jest.fn()} />);
  expect(screen.getByText("Cancel")).toBeTruthy();
  expect(screen.queryByText("+1 hour")).toBeNull();
  await screen.rerender(<PassCard b={{ ...later, from: new Date(NOW + 30 * 60_000).toISOString() }} now={NOW} onCancel={jest.fn()} />);
  expect(screen.queryByText("Cancel")).toBeNull();
});

test("marked spot is shown on the pass", async () => {
  await render(<PassCard b={{ ...base, spot: { floor: "B2", bay: "47", note: "Lift C", photo_url: null } }} now={NOW} onSpot={jest.fn()} />);
  expect(screen.getByText("Floor B2 · Bay 47 · Lift C")).toBeTruthy();
  expect(screen.getByText("Edit spot")).toBeTruthy();
});
