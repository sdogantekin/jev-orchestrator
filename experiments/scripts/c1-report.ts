/**
 * Checkpoint C1 report (section 19.2): generated stream statistics next to the configured
 * distributions, and one example transaction with its world probabilities and simulated
 * outcome. Run with `npm run c1-report`.
 */
import { checkEligibility } from "../../lib/domain/eligibility.js";
import { worldAcceptanceRate } from "../../lib/domain/world.js";
import { loadCurrencyConversion, loadStreamConfig, loadWorldConfig } from "../../lib/simulation/configLoader.js";
import { simulatePspOutcome } from "../../lib/simulation/outcome.js";
import { generateStream } from "../../lib/simulation/stream.js";

const SEED = "c1-demo-seed";
const COUNT = 1000;
const EXAMPLE_INDEX = 500;

const world = loadWorldConfig();
const streamConfig = loadStreamConfig();
const rates = loadCurrencyConversion();

const stream = generateStream(SEED, COUNT, streamConfig, rates);
const n = stream.length;

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function share(predicate: (t: (typeof stream)[number]) => boolean): number {
  return stream.filter(predicate).length / n;
}

console.log(`\n=== C1: generated stream statistics (seed="${SEED}", n=${n}) ===\n`);

console.log("Amount bucket (configured -> generated):");
for (const bucket of ["small", "medium", "large"] as const) {
  const configured = streamConfig.amount.bucketWeights[bucket];
  const generated = share((t) => t.amountBucket === bucket);
  console.log(`  ${bucket.padEnd(7)} ${pct(configured).padStart(6)} -> ${pct(generated)}`);
}

console.log("\nCountry/currency (configured -> generated):");
for (const cc of streamConfig.countryCurrency) {
  const generated = share((t) => t.country === cc.country && t.currency === cc.currency);
  console.log(`  ${cc.country}/${cc.currency}`.padEnd(10) + `${pct(cc.weight).padStart(6)} -> ${pct(generated)}`);
}

console.log("\nPayment method (configured raw weight -> generated actual share):");
for (const method of ["card", "paypal", "sepa_debit"] as const) {
  const configured = streamConfig.paymentMethod[method];
  const generated = share((t) => t.paymentMethod === method);
  console.log(`  ${method.padEnd(11)} ${pct(configured).padStart(6)} -> ${pct(generated)}`);
}
console.log("  (sepa_debit's generated share is lower than its raw weight: it never survives");
console.log("   for non-EUR transactions and is resampled into card/paypal there, per section 5.4.)");

console.log("\nDevice (configured -> generated):");
for (const device of ["mobile", "desktop"] as const) {
  console.log(`  ${device.padEnd(7)} ${pct(streamConfig.device[device]).padStart(6)} -> ${pct(share((t) => t.device === device))}`);
}

console.log("\nCustomer type (configured -> generated):");
for (const ct of ["returning", "new"] as const) {
  console.log(`  ${ct.padEnd(9)} ${pct(streamConfig.customerType[ct]).padStart(6)} -> ${pct(share((t) => t.customerType === ct))}`);
}

const cardTx = stream.filter((t) => t.paymentMethod === "card");
console.log(`\nCard scheme, among card transactions only (configured -> generated, n=${cardTx.length}):`);
for (const scheme of ["visa", "mastercard", "amex"] as const) {
  const generated = cardTx.filter((t) => t.cardScheme === scheme).length / cardTx.length;
  console.log(`  ${scheme.padEnd(11)} ${pct(streamConfig.cardScheme[scheme]).padStart(6)} -> ${pct(generated)}`);
}
const threeDsGenerated = cardTx.filter((t) => t.threeDsEligible).length / cardTx.length;
console.log(`\n3DS eligible, among card transactions (configured -> generated): ${pct(streamConfig.threeDsEligibleRateForCard)} -> ${pct(threeDsGenerated)}`);

console.log(`\n=== Example transaction (index ${EXAMPLE_INDEX}) ===\n`);
const tx = stream[EXAMPLE_INDEX]!;
console.log(JSON.stringify(tx, null, 2));

console.log("\nEligibility, world acceptance rate, and simulated outcome per PSP:\n");
for (const psp of world.psps) {
  const eligibility = checkEligibility(psp, tx);
  if (!eligibility.eligible) {
    console.log(`  ${psp.id.padEnd(6)} INELIGIBLE (${eligibility.reasons.join(", ")})`);
    continue;
  }
  const acceptance = worldAcceptanceRate(world, psp.id, tx, EXAMPLE_INDEX);
  const outcome = simulatePspOutcome(SEED, EXAMPLE_INDEX, tx, psp, world);
  console.log(
    `  ${psp.id.padEnd(6)} eligible | world acceptance ${pct(acceptance)} | ` +
      `available=${outcome.available} authorized=${outcome.authorized} ` +
      `latencyMs=${outcome.latencyMs?.toFixed(0) ?? "n/a"} chargeback=${outcome.chargeback} ` +
      `netCostEUR=${outcome.netCostEUR.toFixed(4)}`
  );
}

console.log("\n(Run `npm test` for the full determinism and common-random-number test suite.)\n");
