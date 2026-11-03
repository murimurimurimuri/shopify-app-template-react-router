export type InsulationLevel = "poor" | "average" | "good";

export type InsulationFactors = {
  poor: number;
  average: number;
  good: number;
};

export type PanelVariant = {
  id: string;
  title: string;
  watts: number;
  power?: string;
  price?: number;
  available?: boolean;
  imageUrl?: string | null;
};

export type PackageLine = {
  variantId: string;
  title: string;
  qty: number;
  watts: number;
  unitPrice?: number;
};

export type RecommendationPackage = {
  id: string;
  label: string;
  lines: PackageLine[];
  totalWatts: number;
  totalPrice: number;
};

export const DEFAULT_INSULATION_FACTORS: InsulationFactors = {
  poor: 100,
  average: 70,
  good: 50,
};

/** Parse watts from a Power option value like "900", "900W", or "900 W". */
export function parsePowerWatts(
  value: string | number | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  const match = String(value).replace(/\s/g, "").match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const n = Number(match[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function requiredWatts(
  roomM2: number,
  insulation: InsulationLevel,
  factors: InsulationFactors = DEFAULT_INSULATION_FACTORS,
): number {
  const factor = factors[insulation] ?? DEFAULT_INSULATION_FACTORS[insulation];
  return Math.ceil(Math.max(0, roomM2) * factor);
}

function packageKey(lines: PackageLine[]): string {
  return lines
    .map((line) => `${line.watts}:${line.qty}`)
    .sort()
    .join("|");
}

function buildLabel(lines: PackageLine[]): string {
  return lines.map((line) => `${line.qty}× ${line.title}`).join(" + ");
}

function toPackage(
  id: string,
  lines: PackageLine[],
): RecommendationPackage | null {
  if (!lines.length) return null;
  const totalWatts = lines.reduce(
    (sum, line) => sum + line.watts * line.qty,
    0,
  );
  const totalPrice = lines.reduce(
    (sum, line) => sum + (line.unitPrice ?? 0) * line.qty,
    0,
  );
  return {
    id,
    label: buildLabel(lines),
    lines,
    totalWatts,
    totalPrice,
  };
}

function panelTitle(variant: PanelVariant): string {
  if (variant.power) {
    const raw = String(variant.power).trim();
    return /w$/i.test(raw) ? raw : `${raw}W`;
  }
  return `${variant.watts}W`;
}

function uniqueByWatts(variantsInput: PanelVariant[]): PanelVariant[] {
  const byWatts = new Map<number, PanelVariant>();
  for (const variant of variantsInput) {
    if (!(variant.watts > 0) || variant.available === false) continue;
    if (!byWatts.has(variant.watts)) {
      byWatts.set(variant.watts, variant);
    }
  }
  return [...byWatts.values()].sort((a, b) => b.watts - a.watts);
}
function greedyPackage(
  variants: PanelVariant[],
  need: number,
  startIndex: number,
): PackageLine[] {
  const lines: PackageLine[] = [];
  let remaining = need;

  for (let i = startIndex; i < variants.length && remaining > 0; i++) {
    const variant = variants[i];
    if (!variant.watts) continue;

    let qty = Math.floor(remaining / variant.watts);
    const remainder = remaining % variant.watts;

    if (remainder > 0) {
      // Prefer one more of this (larger) panel over cascading to smaller ones
      // when this is the last usable size, or when overshoot is acceptable.
      const nextUsable = variants
        .slice(i + 1)
        .find((v) => v.watts > 0 && v.watts <= remaining);
      if (!nextUsable || variant.watts <= remaining * 1.5) {
        qty += 1;
      }
    }

    if (qty <= 0 && remaining > 0 && i === variants.length - 1) {
      qty = 1;
    }

    if (qty > 0) {
      lines.push({
        variantId: variant.id,
        title: panelTitle(variant),
        qty,
        watts: variant.watts,
        unitPrice: variant.price,
      });
      remaining -= qty * variant.watts;
    }
  }

  // If still short (e.g. skipped sizes), top up with the largest panel
  if (remaining > 0 && variants.length) {
    const largest = variants[0];
    const extra = Math.ceil(remaining / largest.watts);
    const existing = lines.find((line) => line.variantId === largest.id);
    if (existing) {
      existing.qty += extra;
    } else {
      lines.unshift({
        variantId: largest.id,
        title: panelTitle(largest),
        qty: extra,
        watts: largest.watts,
        unitPrice: largest.price,
      });
    }
  }

  return lines.filter((line) => line.qty > 0);
}

/**
 * Build at least `minPackages` recommendation packages for a room.
 * Priority: largest panels first, combining variants when needed.
 */
export function recommendPackages(
  roomM2: number,
  insulation: InsulationLevel,
  variantsInput: PanelVariant[],
  factors: InsulationFactors = DEFAULT_INSULATION_FACTORS,
  minPackages = 3,
): { requiredWatts: number; packages: RecommendationPackage[] } {
  const need = requiredWatts(roomM2, insulation, factors);
  // One representative per Power value — ignore color (and other) option duplicates.
  const variants = uniqueByWatts(variantsInput);

  if (!variants.length || need <= 0) {
    return { requiredWatts: need, packages: [] };
  }

  const seen = new Set<string>();
  const packages: RecommendationPackage[] = [];

  const add = (lines: PackageLine[], id: string) => {
    const total = lines.reduce((sum, line) => sum + line.watts * line.qty, 0);
    if (total < need) return;
    const key = packageKey(lines);
    if (seen.has(key)) return;
    seen.add(key);
    const pkg = toPackage(id, lines);
    if (pkg) packages.push(pkg);
  };

  // Package A: classic largest-first greedy
  add(greedyPackage(variants, need, 0), "pkg-largest");

  // Packages B+: start further down the size ladder for distinct mixes
  for (let start = 1; start < variants.length && packages.length < minPackages; start++) {
    add(greedyPackage(variants, need, start), `pkg-start-${start}`);
  }

  // Single-variant quantity packages for each power size
  for (const variant of variants) {
    if (packages.length >= minPackages) break;
    const qty = Math.ceil(need / variant.watts);
    add(
      [
        {
          variantId: variant.id,
          title: panelTitle(variant),
          qty,
          watts: variant.watts,
          unitPrice: variant.price,
        },
      ],
      `pkg-only-${variant.watts}`,
    );
  }

  // Pad only when distinct power mixes are still possible
  let pad = 0;
  while (packages.length < minPackages && packages[0] && variants.length > 1) {
    pad += 1;
    const base = packages[0];
    const lines = base.lines.map((line, index) =>
      index === 0 ? { ...line, qty: line.qty + pad } : { ...line },
    );
    const before = packages.length;
    add(lines, `pkg-pad-${pad}`);
    if (packages.length === before || pad > 10) break;
  }

  return { requiredWatts: need, packages: packages.slice(0, Math.max(packages.length, 1)) };
}
