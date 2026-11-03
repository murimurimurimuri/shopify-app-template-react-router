import assert from "node:assert/strict";
import {
  parsePowerWatts,
  recommendPackages,
  requiredWatts,
} from "./recommend";

assert.equal(parsePowerWatts("900"), 900);
assert.equal(parsePowerWatts("900W"), 900);
assert.equal(parsePowerWatts("900 W"), 900);
assert.equal(parsePowerWatts(null), null);

const variants = [
  { id: "1", title: "Red / 900W", power: "900", watts: 900, price: 30000, available: true },
  { id: "2", title: "Blue / 900W", power: "900", watts: 900, price: 30000, available: true },
  { id: "3", title: "Red / 700W", power: "700", watts: 700, price: 20000, available: true },
  { id: "4", title: "Blue / 700W", power: "700", watts: 700, price: 20000, available: true },
  { id: "5", title: "Red / 450W", power: "450", watts: 450, price: 10000, available: true },
  { id: "6", title: "Blue / 450W", power: "450", watts: 450, price: 10000, available: true },
];

assert.equal(requiredWatts(20, "poor"), 2000);
assert.equal(requiredWatts(20, "average"), 1400);
assert.equal(requiredWatts(20, "good"), 1000);

const { requiredWatts: need, packages } = recommendPackages(20, "average", variants);
assert.equal(need, 1400);
assert.ok(packages.length >= 1);
assert.ok(packages.length <= 3);
assert.ok(packages.every((pkg) => pkg.totalWatts >= need));

// Color duplicates must collapse — labels use Power, not color titles.
assert.ok(packages.every((pkg) => !/red|blue/i.test(pkg.label)));
const preferred = packages[0];
assert.ok(preferred.lines.some((line) => line.watts === 900));

// Same-power-only catalog should yield a single package, not one per color.
const samePowerColors = [
  { id: "a", title: "Red / 900W", power: "900", watts: 900, price: 30000, available: true },
  { id: "b", title: "Blue / 900W", power: "900", watts: 900, price: 30000, available: true },
  { id: "c", title: "Green / 900W", power: "900", watts: 900, price: 30000, available: true },
];
const samePowerResult = recommendPackages(8, "good", samePowerColors);
assert.equal(samePowerResult.packages.length, 1);

console.log("recommend.ts checks passed:", {
  need,
  packageCount: packages.length,
  preferred: preferred.label,
  totals: packages.map((p) => p.totalWatts),
  samePowerOnly: samePowerResult.packages[0]?.label,
});
