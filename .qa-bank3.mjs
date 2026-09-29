export default async function run(page) {
  const out = { errors: [], functionCalls: [], paystackCalls: [] };
  page.on('pageerror', (e) => out.errors.push(String(e)));

  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('functions/v1/verify-identity')) out.functionCalls.push({ url: u, method: r.method() });
    if (u.includes('api.paystack.co')) out.paystackCalls.push(u);
  });

  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('OddZone')) out.consoleLines = (out.consoleLines || []).concat([t.slice(0, 220)]);
  });

  await page.goto('http://localhost:8123/', { waitUntil: 'load' });
  await page.waitForSelector('#auth-email', { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.click('text=Continue as guest');
  await page.waitForTimeout(1500);

  out.secretKeyInClient = await page.evaluate(() => Boolean(window.ODDZONE_CONFIG?.paystack?.secretKey));

  // Drive a real lookup through the UI for OPay.
  await page.evaluate(() => {
    document.getElementById('kyc-modal')?.classList.remove('hidden');
    const s = document.getElementById('kyc-bank-select');
    const opt = Array.from(s.options).find((o) => /opay/i.test(o.textContent));
    if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.fill('#kyc-account-input', '8123456789');
  await page.waitForTimeout(7000);

  out.bankSelected = await page.inputValue('#kyc-bank-select');
  out.cardName = await page.textContent('#kyc-card-acc-name').catch(() => null);
  out.cardBank = await page.textContent('#kyc-card-acc-bank').catch(() => null);
  out.resolveHint = await page.textContent('#kyc-resolved-name').catch(() => null);
  out.functionCalls = out.functionCalls.length;
  out.directPaystackCall = out.paystackCalls.length > 0;

  return out;
}
