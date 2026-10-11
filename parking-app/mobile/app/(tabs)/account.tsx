import { useState } from "react";
import { Alert, ScrollView, Switch, View } from "react-native";
import { SignIn } from "@/components/SignIn";
import { Button, Card, Chip, T } from "@/components/ui";
import { api, ApiFailure, clearSession } from "@/lib/api";
import { forgetPasses } from "@/lib/passes";
import { useTheme } from "@/lib/theme";
import { useMe } from "@/lib/useMe";
import { greeting } from "@/shared/format";

export default function Account() {
  const c = useTheme();
  const { me, reload } = useMe();
  const [msg, setMsg] = useState("");
  if (me === undefined) return null;
  if (me === null) return <ScrollView contentContainerStyle={{ padding: 16 }}><SignIn onDone={reload} /></ScrollView>;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg("");
    try { await fn(); setMsg(ok); await reload(); } catch (x) { Alert.alert("Couldn't save", x instanceof ApiFailure ? x.message : "Try again."); }
  };
  const pref = (body: Record<string, unknown>) => run(() => api("/v1/me/preferences", { method: "PUT", body }), "Saved.");
  const signOut = async () => { await clearSession(); await forgetPasses(); reload(); };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
      <Card>
        <T variant="label">{greeting()}</T>
        <T variant="display" style={{ fontSize: 30 }}>{me.user.full_name ?? me.user.phone}</T>
        <T variant="muted">Vehicles: {me.vehicles.map(v => v.plate).join(", ") || "none yet"}</T>
      </Card>
      <Card>
        <T variant="title">Preferences</T>
        <T variant="label">Usual payment</T>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["upi", "card", "netbanking"] as const).map(m => <Chip key={m} soft label={m === "upi" ? "UPI" : m === "card" ? "Card" : "Bank"} on={me.preferences.payment_method === m} onPress={() => pref({ payment_method: m })} />)}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 48 }}>
          <T>Reminders on WhatsApp</T>
          <Switch accessibilityLabel="Reminders on WhatsApp" value={me.preferences.alerts} onValueChange={v => pref({ alerts: v })} trackColor={{ true: c.sign, false: c.line }} />
        </View>
        <T variant="label">Language</T>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {([["en", "English"], ["kn", "ಕನ್ನಡ"], ["hi", "हिन्दी"]] as const).map(([k, l]) => <Chip key={k} label={l} on={me.preferences.language === k} onPress={() => pref({ language: k })} />)}
        </View>
      </Card>
      <Card>
        <T variant="title">Your data</T>
        <Button kind="ghost" title="Download a copy of my data" onPress={() => run(() => api("/v1/me/data-export", { method: "POST" }), "Export requested. A link will come to your phone.")} />
        <Button kind="ghost" title="Sign out" onPress={signOut} />
        <Button kind="ghost" title="Delete account" onPress={() => Alert.alert("Delete your account?", "Passes stop working. Tax invoices are kept as the law requires.", [
          { text: "Keep", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => run(async () => { await api("/v1/me", { method: "DELETE" }); await signOut(); }, "Account deleted.") }
        ])} />
      </Card>
      {!!msg && <T accessibilityRole="alert" style={{ color: c.ok }}>{msg}</T>}
    </ScrollView>
  );
}
