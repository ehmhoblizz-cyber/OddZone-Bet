export default async function run(page) {
  const out = { errors: [] };
  page.on('pageerror', (e) => out.errors.push(String(e)));

  await page.goto('http://localhost:8123/', { waitUntil: 'load' });
  await page.waitForSelector('#auth-email', { timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.click('text=Continue as guest');
  await page.waitForTimeout(1500);

  const openKyc = async () => {
    await page.evaluate(() => {
      const m = document.getElementById('kyc-status-msg');
      if (m) m.textContent = '';
      document.getElementById('kyc-modal')?.classList.remove('hidden');
      const btn = document.getElementById('btn-submit-kyc');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-shield-halved text-xs"></i><span>VERIFY REAL IDENTITY</span>';
      }
      const s = document.getElementById('kyc-bank-select');
      const opt = Array.from(s.options).find((o) => /opay/i.test(o.textContent));
      if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(500);
    await page.fill('#kyc-account-input', '8123456789');
    await page.fill('#kyc-name-input', 'Chinedu Okafor');
    await page.fill('#kyc-number-input', '22234567890');
    await page.fill('#kyc-dob-input', '1993-04-22');
  };

  const submit = async () => {
    await page.evaluate(() => document.getElementById('btn-submit-kyc')?.click());
    await page.waitForFunction(() => {
      const t = document.getElementById('kyc-status-msg')?.textContent || '';
      return t && !t.includes('Verifying details');
    }, { timeout: 25000 }).catch(() => {});
    return page.textContent('#kyc-status-msg').catch(() => null);
  };

  await openKyc();
  out.kycStatus = await submit();
  out.kycStored = await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('oddzone-current-user') || 'null');
    return { isVerified: u?.isVerified, accountName: u?.kyc?.accountName, bankName: u?.kyc?.bankName };
  });

  // Is the name shown on the account card a real lookup, or just a fallback?
  out.cardName = await page.textContent('#kyc-card-acc-name').catch(() => null);

  out.pageErrors = out.errors;
  return out;
}
