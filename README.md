# Heating Panel Advisor

Shopify app that recommends heating panel variants from a single product using a storefront wizard.

## What it does

1. Shopper opens an Online Store page with the **Heating Panel Advisor** app block.
2. Enters room size (m²) and insulation quality (Poor / Average / Good).
3. Sees **at least three** panel packages sized to the room.
4. Packages prefer **largest panels first**, and combine variants when one panel is not enough.
5. Shopper can add a package to the cart.

Required watts = `room m² × insulation factor` (defaults: Poor **100**, Average **70**, Good **50** W/m²).

Heating power comes from the product’s **Power** variant option (not a metafield).

## Product setup

On your heating panels product, add a variant option named **Power** with watt values, for example:

| Variant | Power |
| --- | --- |
| Small | 450 |
| Medium | 700 |
| Large | 900 |

Values like `900W` also work — the app extracts the number.

## Project layout

- `app/` — embedded admin (product picker, insulation factors, Power preview)
- `app/lib/recommend.ts` — recommendation engine
- `extensions/panel-advisor/` — Theme App Extension (wizard UI + illustrations)

## Setup

```bash
npm install
npm run dev
```

Then:

1. In the app admin, select your heating panels product (with a **Power** option).
2. Optionally adjust insulation W/m² factors.
3. Online Store → Pages → Add page → add **Heating Panel Advisor** block → pick the same product → publish.

## Verify recommendation logic locally

```bash
npm run test:recommend
```
