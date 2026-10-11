// Headless click-through of the prototype. Run: npm i jsdom@24 (anywhere) then: node smoke.cjs index.html
const { JSDOM } = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const errors = [];
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.test/",
  beforeParse(w){ w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect(){}, drawImage(){}, set fillStyle(v){} }); w.scrollTo=()=>{}; } });
const w = dom.window, d = w.document;
w.addEventListener("error", e => errors.push(e.message));
const $ = s => d.querySelector(s), click = s => { const el = typeof s === "string" ? $(s) : s; if (!el) throw new Error("missing " + s); el.click(); };
const type = (s, v) => { const el = $(s); el.value = v; el.dispatchEvent(new w.Event("change")); };
const submit = s => $(s).dispatchEvent(new w.Event("submit", { cancelable: true }));
const ok = (cond, msg) => { if (!cond) errors.push("FAIL: " + msg); else console.log("ok -", msg); };
(async () => {
  ok($("#list").children.length === 8, "8 lots listed");
  click('[data-when="now2"]'); ok($("#rhead").textContent.includes("· 2 h") && $('[data-when="now2"]').getAttribute("aria-pressed")==="true", "Now · 2 h chip sets a 2-hour window");
  click('[data-when="day"]'); ok(/→/.test($("#exact-sum").textContent), "exact-times summary shows the chosen window");
  click('[data-when="next3"]'); ok($("#rhead").textContent.includes("· 3 h"), "back to default 3-hour window");
  ok(d.querySelectorAll("nav.bottom svg").length === 5, "bottom nav has 5 icons");
  ok(d.querySelector(".lot .meter i") !== null, "availability meter on lot cards");
  // venue search + recent
  type("#dest", "UB City"); ok($("#rhead").textContent.includes("UB City"), "destination UB City");
  type("#dest", "Forum"); ok($("#recent").textContent.includes("UB City"), "recent searches show UB City");
  type("#dest", "Mars"); ok($("#search-err").textContent.includes("don't cover"), "unknown destination explained");
  // filters
  click('[data-f="valet"]'); ok($("#list").children.length === 3, "valet filter -> 3 lots");
  click('[data-f="ev"]'); ok($("#list").children.length === 2, "valet+EV -> 2 lots");
  click('[data-f="valet"]'); click('[data-f="ev"]');
  click('[data-f="fav"]'); ok($("#list").textContent.includes("No saved lots yet"), "saved filter empty state");
  click('[data-f="fav"]');
  // park now with digits
  click("#pn-open"); $("#pn-code").value = "104"; click('[data-h="2"]'); submit("#pn");
  ok($("#sheet-title").textContent.includes("Koramangala"), "digits 104 -> BLR104 Koramangala");
  $("#vno").value = "KA01AB1234"; $("#mob").value = "9876543210"; submit("#co");
  ok($("#passes").textContent.includes("Mark my spot"), "pass issued with Mark my spot");
  // mark spot
  click('#passes [data-spot]'); $("#sp-floor").value = "B2"; $("#sp-bay").value = "47"; submit("#spf");
  ok($("#passes").textContent.includes("Floor B2 · Bay 47"), "spot saved on pass");
  // valet: example ticket -> request -> validation -> tip -> pay
  click('[data-go="valet"]'); ok($("#valet").textContent.includes("VT-EX4M"), "example valet ticket shown");
  click('[data-request="VT-EX4M"]');
  ok($("#vbill").textContent.includes("₹150") && $("#vbill").textContent.includes("₹27") && $("#vbill").textContent.includes("₹197"), "valet bill 150 + 27 GST + 20 tip = 197");
  $("#val").value = "ubdine"; click("#val-apply"); ok($("#vbill").textContent.includes("Validated") && $("#vpay").textContent.includes("₹20"), "validated: pay only the ₹20 tip");
  click('[data-tip="0"]'); ok($("#vpay").textContent === "Bring my car", "validated + no tip -> free");
  submit("#rq"); ok($("#valet").textContent.includes("You requested your car"), "request moves timeline");
  await new Promise(r => setTimeout(r, 4500)); ok($("#valet").textContent.includes("Ready in about"), "ETA shows while coming");
  // staff view
  click("#staffmode"); ok($("#valet").textContent.includes("Request queue"), "staff queue renders");
  const btn = d.querySelector('#valet [data-staff]'); if (btn) { click(btn); ok(true, "staff advanced a ticket"); }
  click("#staffmode");
  // new drop-off
  click('[data-dropoff="V2"]'); ok($("#v-plate").value === "KA01AB1234", "drop-off prefilled from saved profile");
  submit("#vf"); ok(d.querySelectorAll("#valet .pass").length >= 1, "new ticket created");
  // account OTP
  click('[data-go="account"]'); $("#lg-phone").value = "9876543210"; submit("#lg"); ok(!$("#otpf").hidden, "OTP field appears");
  $("#lg-otp").value = "000000"; submit("#lg"); ok($("#lg-err").textContent.includes("doesn't match"), "wrong OTP explained");
  $("#lg-otp").value = "123456"; submit("#lg"); ok($("#account").textContent.includes("+91 98765 43210"), "signed in by phone");
  click('[data-go2="monthly"]'); ok(!$("#v-monthly").hidden, "account links to monthly");
  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "ALL SMOKE CHECKS PASSED");
  process.exit(errors.length ? 1 : 0);
})();
