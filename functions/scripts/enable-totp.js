/*
  Enable TOTP MFA for this Firebase project (Identity Platform).

  Requirements:
  - firebase-admin >= 11.6.0 (this repo uses ^13.x)
  - Credentials available via GOOGLE_APPLICATION_CREDENTIALS or ADC.

  Usage (from functions/):
    node scripts/enable-totp.js

  Optional env:
    TOTP_ADJACENT_INTERVALS=5  (0..10)
*/

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

initializeApp();

function parseAdjacentIntervals() {
  const raw = String(process.env.TOTP_ADJACENT_INTERVALS || '5').trim();
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    throw new Error('TOTP_ADJACENT_INTERVALS must be a number from 0 to 10');
  }
  return value;
}

async function main() {
  const adjacentIntervals = parseAdjacentIntervals();

  console.log(`[enable-totp] enabling TOTP MFA (adjacentIntervals=${adjacentIntervals})`);

  await getAuth().projectConfigManager().updateProjectConfig({
    multiFactorConfig: {
      providerConfigs: [
        {
          state: 'ENABLED',
          totpProviderConfig: {
            adjacentIntervals,
          },
        },
      ],
    },
  });

  console.log('[enable-totp] done');
}

main().catch((err) => {
  console.error('[enable-totp] failed', err);
  process.exitCode = 1;
});
