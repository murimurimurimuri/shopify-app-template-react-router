import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useCallback, useState } from "react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { DEFAULT_INSULATION_FACTORS, parsePowerWatts } from "../lib/recommend";

type ShopConfig = {
  panelProductId: string | null;
  panelProductHandle: string | null;
  insulationPoor: number;
  insulationAverage: number;
  insulationGood: number;
};

type VariantRow = {
  id: string;
  title: string;
  powerLabel: string | null;
  watts: number | null;
};

type ProductSummary = {
  id: string;
  title: string;
  handle: string;
  hasPowerOption: boolean;
  variants: VariantRow[];
} | null;

function parseIntOr(
  value: string | number | null | undefined,
  fallback: number,
): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const shopResponse = await admin.graphql(
    `#graphql
      query PanelAdvisorShopConfig {
        shop {
          id
          panelProductId: metafield(key: "panel_product_id") {
            value
          }
          panelProductHandle: metafield(key: "panel_product_handle") {
            value
          }
          insulationPoor: metafield(key: "insulation_poor_w_m2") {
            value
          }
          insulationAverage: metafield(key: "insulation_average_w_m2") {
            value
          }
          insulationGood: metafield(key: "insulation_good_w_m2") {
            value
          }
        }
      }`,
  );

  const shopJson = await shopResponse.json();
  const shop = shopJson.data?.shop;

  const config: ShopConfig = {
    panelProductId: shop?.panelProductId?.value ?? null,
    panelProductHandle: shop?.panelProductHandle?.value ?? null,
    insulationPoor: parseIntOr(
      shop?.insulationPoor?.value,
      DEFAULT_INSULATION_FACTORS.poor,
    ),
    insulationAverage: parseIntOr(
      shop?.insulationAverage?.value,
      DEFAULT_INSULATION_FACTORS.average,
    ),
    insulationGood: parseIntOr(
      shop?.insulationGood?.value,
      DEFAULT_INSULATION_FACTORS.good,
    ),
  };

  let product: ProductSummary = null;

  if (config.panelProductId) {
    const productResponse = await admin.graphql(
      `#graphql
        query PanelAdvisorProduct($id: ID!) {
          product(id: $id) {
            id
            title
            handle
            options {
              name
            }
            variants(first: 50) {
              nodes {
                id
                title
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }`,
      { variables: { id: config.panelProductId } },
    );
    const productJson = await productResponse.json();
    const p = productJson.data?.product;
    if (p) {
      const hasPowerOption = (p.options ?? []).some(
        (opt: { name: string }) => opt.name.trim().toLowerCase() === "power",
      );
      product = {
        id: p.id,
        title: p.title,
        handle: p.handle,
        hasPowerOption,
        variants: (p.variants?.nodes ?? []).map(
          (v: {
            id: string;
            title: string;
            selectedOptions?: { name: string; value: string }[];
          }) => {
            const powerOpt = (v.selectedOptions ?? []).find(
              (opt) => opt.name.trim().toLowerCase() === "power",
            );
            return {
              id: v.id,
              title: v.title,
              powerLabel: powerOpt?.value ?? null,
              watts: parsePowerWatts(powerOpt?.value),
            };
          },
        ),
      };
    }
  }

  const powersFilled =
    !!product &&
    product.hasPowerOption &&
    product.variants.length > 0 &&
    product.variants.every((v) => v.watts != null && v.watts > 0);

  return { config, product, powersFilled };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  const shopResponse = await admin.graphql(
    `#graphql
      query ShopId {
        shop { id }
      }`,
  );
  const shopJson = await shopResponse.json();
  const shopId = shopJson.data?.shop?.id as string;

  if (intent === "save_product") {
    const productId = String(formData.get("productId") || "");
    const productHandle = String(formData.get("productHandle") || "");
    if (!productId) {
      return { ok: false, error: "Select a product first." };
    }

    const response = await admin.graphql(
      `#graphql
        mutation SavePanelProduct($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              ownerId: shopId,
              key: "panel_product_id",
              type: "single_line_text_field",
              value: productId,
            },
            {
              ownerId: shopId,
              key: "panel_product_handle",
              type: "single_line_text_field",
              value: productHandle,
            },
          ],
        },
      },
    );
    const json = await response.json();
    const errors = json.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      return {
        ok: false,
        error: errors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    return { ok: true, message: "Heating panels product saved." };
  }

  if (intent === "save_insulation") {
    const poor = parseIntOr(
      String(formData.get("insulationPoor")),
      DEFAULT_INSULATION_FACTORS.poor,
    );
    const average = parseIntOr(
      String(formData.get("insulationAverage")),
      DEFAULT_INSULATION_FACTORS.average,
    );
    const good = parseIntOr(
      String(formData.get("insulationGood")),
      DEFAULT_INSULATION_FACTORS.good,
    );

    const response = await admin.graphql(
      `#graphql
        mutation SaveInsulation($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }`,
      {
        variables: {
          metafields: [
            {
              ownerId: shopId,
              key: "insulation_poor_w_m2",
              type: "number_integer",
              value: String(poor),
            },
            {
              ownerId: shopId,
              key: "insulation_average_w_m2",
              type: "number_integer",
              value: String(average),
            },
            {
              ownerId: shopId,
              key: "insulation_good_w_m2",
              type: "number_integer",
              value: String(good),
            },
          ],
        },
      },
    );
    const json = await response.json();
    const errors = json.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) {
      return {
        ok: false,
        error: errors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    return { ok: true, message: "Insulation factors saved." };
  }

  return { ok: false, error: "Unknown action." };
};

export default function Index() {
  const { config, product, powersFilled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [selectedProduct, setSelectedProduct] = useState<{
    id: string;
    handle: string;
    title: string;
  } | null>(
    product
      ? { id: product.id, handle: product.handle, title: product.title }
      : null,
  );

  const busy = navigation.state !== "idle";

  const pickProduct = useCallback(async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
      action: "select",
      selectionIds: selectedProduct?.id
        ? [{ id: selectedProduct.id }]
        : undefined,
    });
    if (!selected || selected.length === 0) return;
    const p = selected[0] as { id: string; handle: string; title: string };
    setSelectedProduct({ id: p.id, handle: p.handle, title: p.title });
  }, [shopify, selectedProduct?.id]);

  return (
    <s-page heading="Heating Panel Advisor">
      {actionData && "message" in actionData && actionData.message ? (
        <s-banner tone="success" heading={actionData.message} />
      ) : null}
      {actionData && "error" in actionData && actionData.error ? (
        <s-banner tone="critical" heading={actionData.error} />
      ) : null}

      <s-section heading="Setup checklist">
        <s-unordered-list>
          <s-list-item>
            {product ? "✓" : "○"} Select the heating panels product
          </s-list-item>
          <s-list-item>
            {powersFilled ? "✓" : "○"} Product has a Power option with watt
            values on each variant
          </s-list-item>
          <s-list-item>
            ○ Create an Online Store page and add the “Heating Panel Advisor”
            app block
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="1. Heating panels product">
        <s-paragraph>
          Choose the product whose variants use an option named{" "}
          <strong>Power</strong> (for example 450, 700, 900). The advisor
          reads watts from that option — no capacity metafield needed.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button onClick={pickProduct}>
            {selectedProduct ? "Change product" : "Select product"}
          </s-button>
          {selectedProduct ? (
            <s-text>
              {selectedProduct.title} ({selectedProduct.handle})
            </s-text>
          ) : (
            <s-text>No product selected yet.</s-text>
          )}
        </s-stack>
        <Form method="post">
          <input type="hidden" name="intent" value="save_product" />
          <input
            type="hidden"
            name="productId"
            value={selectedProduct?.id ?? ""}
          />
          <input
            type="hidden"
            name="productHandle"
            value={selectedProduct?.handle ?? ""}
          />
          <s-button
            type="submit"
            variant="primary"
            {...(busy || !selectedProduct ? { disabled: true } : {})}
          >
            Save product
          </s-button>
        </Form>
      </s-section>

      <s-section heading="2. Insulation factors (W/m²)">
        <s-paragraph>
          Required watts = room m² × factor. Defaults: Poor 100 / Average 70 /
          Good 50.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="save_insulation" />
          <s-stack direction="block" gap="base">
            <label>
              <span>Poor insulation (W/m²)</span>
              <input
                type="number"
                name="insulationPoor"
                min={1}
                defaultValue={String(config.insulationPoor)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: "0.35rem",
                  padding: "0.5rem 0.75rem",
                  font: "inherit",
                }}
              />
            </label>
            <label>
              <span>Average insulation (W/m²)</span>
              <input
                type="number"
                name="insulationAverage"
                min={1}
                defaultValue={String(config.insulationAverage)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: "0.35rem",
                  padding: "0.5rem 0.75rem",
                  font: "inherit",
                }}
              />
            </label>
            <label>
              <span>Good insulation (W/m²)</span>
              <input
                type="number"
                name="insulationGood"
                min={1}
                defaultValue={String(config.insulationGood)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: "0.35rem",
                  padding: "0.5rem 0.75rem",
                  font: "inherit",
                }}
              />
            </label>
            <s-button
              type="submit"
              variant="primary"
              {...(busy ? { disabled: true } : {})}
            >
              Save insulation factors
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="3. Power option on variants">
        {!product ? (
          <s-paragraph>Save a product first to preview Power values.</s-paragraph>
        ) : !product.hasPowerOption ? (
          <s-banner
            tone="warning"
            heading="This product has no option named Power"
          >
            In Shopify Admin → Products, add a variant option called Power with
            watt values (e.g. 450, 700, 900).
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Values below are read from the product’s Power option (edit them on
              the product in Shopify Admin).
            </s-paragraph>
            {product.variants.map((variant) => (
              <s-text key={variant.id}>
                {variant.title}: {variant.powerLabel ?? "—"}
                {variant.watts != null ? ` → ${variant.watts} W` : " (invalid watts)"}
              </s-text>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="4. Add the wizard to your storefront">
        <s-ordered-list>
          <s-list-item>
            In Shopify admin, go to Online Store → Pages → Add page (for example
            “Heating advisor”).
          </s-list-item>
          <s-list-item>
            Click Add section / Add block and choose Heating Panel Advisor from
            your app.
          </s-list-item>
          <s-list-item>
            In the block settings, select the same heating panels product, then
            save and publish the page.
          </s-list-item>
        </s-ordered-list>
        <s-paragraph>
          Shoppers open that page, enter room size and insulation, and get at
          least three panel packages (largest panels preferred, combinations when
          needed).
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
