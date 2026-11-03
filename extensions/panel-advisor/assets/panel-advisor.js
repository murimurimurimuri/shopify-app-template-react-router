(function () {
  "use strict";

  var DEFAULT_FACTORS = { poor: 100, average: 70, good: 50 };

  function requiredWatts(roomM2, insulation, factors) {
    var f = (factors && factors[insulation]) || DEFAULT_FACTORS[insulation] || 70;
    return Math.ceil(Math.max(0, roomM2) * f);
  }

  function packageKey(lines) {
    return lines
      .map(function (l) {
        return l.watts + ":" + l.qty;
      })
      .sort()
      .join("|");
  }

  function buildLabel(lines) {
    return lines
      .map(function (l) {
        return l.qty + "× " + l.title;
      })
      .join(" + ");
  }

  function uniqueByWatts(variantsInput) {
    var byWatts = {};
    (variantsInput || []).forEach(function (v) {
      if (!v || !(v.watts > 0) || v.available === false) return;
      var key = String(v.watts);
      var existing = byWatts[key];
      if (!existing) {
        byWatts[key] = v;
        return;
      }
      // Prefer an available variant; otherwise keep the first seen.
      if (existing.available === false && v.available !== false) {
        byWatts[key] = v;
      }
    });
    return Object.keys(byWatts)
      .map(function (k) {
        return byWatts[k];
      })
      .sort(function (a, b) {
        return b.watts - a.watts;
      });
  }

  function panelTitle(variant) {
    if (variant.power) {
      var raw = String(variant.power).trim();
      return /w$/i.test(raw) ? raw : raw + "W";
    }
    return variant.watts + "W";
  }

  function greedyPackage(variants, need, startIndex) {
    var lines = [];
    var remaining = need;
    var i;
    for (i = startIndex; i < variants.length && remaining > 0; i++) {
      var variant = variants[i];
      if (!variant.watts) continue;
      var qty = Math.floor(remaining / variant.watts);
      var remainder = remaining % variant.watts;
      if (remainder > 0) {
        var nextUsable = null;
        var j;
        for (j = i + 1; j < variants.length; j++) {
          if (variants[j].watts > 0 && variants[j].watts <= remaining) {
            nextUsable = variants[j];
            break;
          }
        }
        if (!nextUsable || variant.watts <= remaining * 1.5) qty += 1;
      }
      if (qty <= 0 && remaining > 0 && i === variants.length - 1) qty = 1;
      if (qty > 0) {
        lines.push({
          variantId: variant.id,
          title: panelTitle(variant),
          qty: qty,
          watts: variant.watts,
          unitPrice: variant.price || 0,
        });
        remaining -= qty * variant.watts;
      }
    }
    if (remaining > 0 && variants.length) {
      var largest = variants[0];
      var extra = Math.ceil(remaining / largest.watts);
      var existing = null;
      for (i = 0; i < lines.length; i++) {
        if (lines[i].variantId === largest.id) {
          existing = lines[i];
          break;
        }
      }
      if (existing) existing.qty += extra;
      else
        lines.unshift({
          variantId: largest.id,
          title: panelTitle(largest),
          qty: extra,
          watts: largest.watts,
          unitPrice: largest.price || 0,
        });
    }
    return lines.filter(function (l) {
      return l.qty > 0;
    });
  }

  function recommendPackages(roomM2, insulation, variantsInput, factors, minPackages) {
    minPackages = minPackages || 3;
    var need = requiredWatts(roomM2, insulation, factors || DEFAULT_FACTORS);
    // One representative per Power value — ignore color (and other) option duplicates.
    var variants = uniqueByWatts(variantsInput);

    if (!variants.length || need <= 0) return { requiredWatts: need, packages: [] };

    var seen = {};
    var packages = [];

    function add(lines, id) {
      var total = 0;
      var i;
      for (i = 0; i < lines.length; i++) total += lines[i].watts * lines[i].qty;
      if (total < need) return;
      var key = packageKey(lines);
      if (seen[key]) return;
      seen[key] = true;
      var price = 0;
      for (i = 0; i < lines.length; i++) price += (lines[i].unitPrice || 0) * lines[i].qty;
      packages.push({
        id: id,
        label: buildLabel(lines),
        lines: lines,
        totalWatts: total,
        totalPrice: price,
      });
    }

    add(greedyPackage(variants, need, 0), "pkg-largest");

    var start;
    for (start = 1; start < variants.length && packages.length < minPackages; start++) {
      add(greedyPackage(variants, need, start), "pkg-start-" + start);
    }

    var v;
    for (v = 0; v < variants.length && packages.length < minPackages; v++) {
      var variant = variants[v];
      var qty = Math.ceil(need / variant.watts);
      add(
        [
          {
            variantId: variant.id,
            title: panelTitle(variant),
            qty: qty,
            watts: variant.watts,
            unitPrice: variant.price || 0,
          },
        ],
        "pkg-only-" + variant.watts,
      );
    }

    // Only pad when we still lack distinct power mixes — never invent color duplicates.
    var pad = 0;
    while (packages.length < minPackages && packages[0] && variants.length > 1) {
      pad += 1;
      var base = packages[0];
      var lines = base.lines.map(function (line, index) {
        return index === 0
          ? {
              variantId: line.variantId,
              title: line.title,
              qty: line.qty + pad,
              watts: line.watts,
              unitPrice: line.unitPrice,
            }
          : {
              variantId: line.variantId,
              title: line.title,
              qty: line.qty,
              watts: line.watts,
              unitPrice: line.unitPrice,
            };
      });
      var before = packages.length;
      add(lines, "pkg-pad-" + pad);
      if (packages.length === before || pad > 10) break;
    }

    return { requiredWatts: need, packages: packages };
  }

  function formatWithDelimiters(number, precision, thousands, decimal) {
    precision = precision == null ? 2 : precision;
    thousands = thousands == null ? "," : thousands;
    decimal = decimal == null ? "." : decimal;
    if (isNaN(number) || number == null) return "0";
    var fixed = (number / 100).toFixed(precision);
    var parts = fixed.split(".");
    var dollars = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return precision === 0 ? dollars : dollars + decimal + (parts[1] || "");
  }

  function formatMoney(cents, moneyFormat) {
    if (window.Shopify && typeof window.Shopify.formatMoney === "function") {
      return window.Shopify.formatMoney(cents, moneyFormat);
    }

    var value = "";
    var formatString = moneyFormat || "{{amount}}";
    var placeholderMatch = formatString.match(/\{\{\s*(\w+)\s*\}\}/);
    var placeholder = placeholderMatch ? placeholderMatch[1] : "amount";

    switch (placeholder) {
      case "amount":
        value = formatWithDelimiters(cents, 2, ",", ".");
        break;
      case "amount_no_decimals":
        value = formatWithDelimiters(cents, 0, ",", ".");
        break;
      case "amount_with_comma_separator":
        value = formatWithDelimiters(cents, 2, ".", ",");
        break;
      case "amount_no_decimals_with_comma_separator":
        value = formatWithDelimiters(cents, 0, ".", ",");
        break;
      case "amount_with_apostrophe_separator":
        value = formatWithDelimiters(cents, 2, "'", ".");
        break;
      case "amount_no_decimals_with_space_separator":
        value = formatWithDelimiters(cents, 0, " ", ".");
        break;
      case "amount_with_space_separator":
        value = formatWithDelimiters(cents, 2, " ", ",");
        break;
      case "amount_with_period_and_space_separator":
        value = formatWithDelimiters(cents, 2, " ", ".");
        break;
      default:
        value = formatWithDelimiters(cents, 2, ",", ".");
    }

    return formatString.replace(/\{\{\s*\w+\s*\}\}/, value);
  }

  function init(root) {
    if (!root || root.dataset.paReady) return;
    root.dataset.paReady = "1";

    var dataEl = root.querySelector("[data-pa-config]");
    if (!dataEl) return;

    var config;
    try {
      config = JSON.parse(dataEl.textContent);
    } catch (e) {
      return;
    }

    var step = 1;
    var roomM2 = "";
    var insulation = null;
    var result = null;

    var panels = {
      step1: root.querySelector('[data-pa-step="1"]'),
      step2: root.querySelector('[data-pa-step="2"]'),
      step3: root.querySelector('[data-pa-step="3"]'),
      empty: root.querySelector("[data-pa-empty]"),
    };

    var roomInput = root.querySelector("[data-pa-room]");
    var resultsMount = root.querySelector("[data-pa-results]");
    var requiredEl = root.querySelector("[data-pa-required]");
    var progressItems = root.querySelectorAll("[data-pa-progress-step]");
    var statusEl = root.querySelector("[data-pa-status]");
    var stepLabel = root.querySelector("[data-pa-step-label]");
    var backBtn = root.querySelector("[data-pa-back]");
    var nextBtn = root.querySelector("[data-pa-next]");
    var restartBtn = root.querySelector("[data-pa-restart]");
    var totalSteps = Number(root.getAttribute("data-total-steps") || progressItems.length || 3);

    function setStatus(msg) {
      if (statusEl) statusEl.textContent = msg || "";
    }

    function updateFooter(n) {
      if (backBtn) backBtn.hidden = n <= 1;
      if (restartBtn) restartBtn.hidden = n !== 3;
      if (nextBtn) {
        nextBtn.hidden = n === 3;
        nextBtn.textContent = n === 2 ? "See recommendations" : "Continue";
      }
    }

    function showStep(n) {
      step = n;
      ["step1", "step2", "step3"].forEach(function (key, idx) {
        var el = panels[key];
        if (!el) return;
        var active = idx + 1 === n;
        el.hidden = !active;
        el.classList.toggle("is-active", active);
      });
      progressItems.forEach(function (el) {
        var s = Number(el.getAttribute("data-pa-progress-step"));
        el.classList.toggle("is-current", s === n);
        el.classList.toggle("is-done", s < n);
        var btn = el.querySelector("button");
        if (btn) {
          if (s === n) btn.setAttribute("aria-current", "step");
          else btn.removeAttribute("aria-current");
        }
      });
      if (stepLabel) {
        stepLabel.textContent = "Step " + n + " of " + totalSteps;
      }
      updateFooter(n);
    }

    function renderResults() {
      if (!resultsMount || !result) return;
      if (requiredEl) {
        requiredEl.textContent = result.requiredWatts + " W";
      }
      if (!result.packages.length) {
        resultsMount.innerHTML =
          '<p class="pa-msg">No panels with a Power option are available yet. Add a Power variant option (e.g. 450, 700, 900) on the product.</p>';
        return;
      }

      resultsMount.innerHTML = result.packages
        .map(function (pkg, index) {
          var linesHtml = pkg.lines
            .map(function (line) {
              return (
                "<li><strong>" +
                line.qty +
                "×</strong> " +
                escapeHtml(line.title) +
                " <span class=\"pa-muted\">(" +
                line.watts +
                " W each)</span></li>"
              );
            })
            .join("");
          var preferred = index === 0 ? ' <span class="pa-badge">Best fit</span>' : "";
          return (
            '<article class="pa-package' +
            (index === 0 ? " is-preferred" : "") +
            '" data-pa-package="' +
            escapeAttr(pkg.id) +
            '">' +
            "<header><h3>" +
            escapeHtml(pkg.label) +
            preferred +
            "</h3>" +
            '<p class="pa-package-meta">' +
            pkg.totalWatts +
            " W total · " +
            formatMoney(pkg.totalPrice, config.moneyFormat) +
            "</p></header>" +
            "<ul>" +
            linesHtml +
            "</ul>" +
            '<button type="button" class="panel-advisor__button panel-advisor__button--primary" data-pa-add="' +
            escapeAttr(pkg.id) +
            '">Add package to cart</button>' +
            "</article>"
          );
        })
        .join("");
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function escapeAttr(str) {
      return escapeHtml(str).replace(/'/g, "&#39;");
    }

    function addPackageToCart(pkgId) {
      var pkg = result && result.packages.find(function (p) {
        return p.id === pkgId;
      });
      if (!pkg) return;
      setStatus("Adding to cart…");
      var items = pkg.lines.map(function (line) {
        var id = String(line.variantId).replace(/\D/g, "");
        return { id: Number(id), quantity: line.qty };
      });

      fetch(window.Shopify && window.Shopify.routes ? window.Shopify.routes.root + "cart/add.js" : "/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: items }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Cart error");
          return res.json();
        })
        .then(function () {
          setStatus("Added to cart.");
          document.documentElement.dispatchEvent(new CustomEvent("cart:refresh"));
          if (window.Shopify && window.Shopify.theme) {
            /* theme-specific hooks may listen */
          }
        })
        .catch(function () {
          setStatus("Could not add to cart. Please try again.");
        });
    }

    root.addEventListener("click", function (event) {
      var t = event.target;
      if (!(t instanceof Element)) return;

      var nextEl = t.closest("[data-pa-next]");
      if (nextEl) {
        if (step === 1) {
          var val = Number(roomInput && roomInput.value);
          if (!val || val <= 0) {
            setStatus("Enter your room size in square meters.");
            if (roomInput) roomInput.focus();
            return;
          }
          roomM2 = val;
          setStatus("");
          showStep(2);
          return;
        }
        if (step === 2) {
          if (!insulation) {
            setStatus("Choose an insulation level.");
            return;
          }
          result = recommendPackages(roomM2, insulation, config.variants || [], config.factors || DEFAULT_FACTORS, 3);
          renderResults();
          setStatus("");
          showStep(3);
        }
        return;
      }

      if (t.closest("[data-pa-back]")) {
        setStatus("");
        showStep(Math.max(1, step - 1));
        return;
      }

      if (t.closest("[data-pa-restart]")) {
        roomM2 = "";
        insulation = null;
        result = null;
        if (roomInput) roomInput.value = "";
        root.querySelectorAll("[data-pa-insulation]").forEach(function (el) {
          el.classList.remove("is-selected");
          el.setAttribute("aria-pressed", "false");
        });
        setStatus("");
        showStep(1);
        return;
      }

      var insulationBtn = t.closest("[data-pa-insulation]");
      if (insulationBtn) {
        insulation = insulationBtn.getAttribute("data-pa-insulation");
        root.querySelectorAll("[data-pa-insulation]").forEach(function (el) {
          var on = el === insulationBtn;
          el.classList.toggle("is-selected", on);
          el.setAttribute("aria-pressed", on ? "true" : "false");
        });
        setStatus("");
        return;
      }

      var addBtn = t.closest("[data-pa-add]");
      if (addBtn) addPackageToCart(addBtn.getAttribute("data-pa-add"));
    });

    if (!config.variants || !config.variants.length) {
      if (panels.empty) panels.empty.hidden = false;
      ["step1", "step2", "step3"].forEach(function (key) {
        if (panels[key]) panels[key].hidden = true;
      });
      var footer = root.querySelector("[data-pa-footer]");
      if (footer) footer.hidden = true;
      return;
    }

    if (panels.empty) panels.empty.hidden = true;
    showStep(1);
  }

  function boot() {
    document.querySelectorAll("[data-panel-advisor]").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener("shopify:section:load", boot);
})();
