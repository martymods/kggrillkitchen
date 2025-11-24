/*
 * KG Grill Kitchen – front‑end logic
 *
 * This script powers the menu, cart, geolocation, mapping and payment flows for
 * the KG Grill Kitchen ordering site. It renders menu items, manages a cart
 * with quantity controls, calculates delivery fees based on the customer’s
 * distance from the restaurant, persists user details via localStorage and
 * integrates with Stripe for card and wallet payments. When delivery is
 * selected, the customer’s location is requested and a Leaflet map shows
 * the route between the restaurant and the drop‑off point. Totals are
 * recalculated whenever the cart or fulfilment method changes.
 */

const {
  mains = [],
  sides = [],
  portionOptions = {},
  getEffectivePrices,
  loadPriceOverrides,
  savePriceOverrides,
  PRICE_OVERRIDE_STORAGE_KEY,
  computeInlineBasePrice: providedComputeInlineBasePrice,
} = window.KG_MENU_DATA || {};

const computeInlineBasePrice = providedComputeInlineBasePrice || function computeInlineBasePrice(basePrice, itemId) {
  let price = basePrice;

  // Special case: single-piece sides currently $3.50 → $3 in-line
  if (['side_chicken_wing', 'side_chicken_kabob', 'side_beef_kabob', 'side_shrimp_kabob'].includes(itemId)) {
    return 3.0;
  }

  // Remove .50 where it exists
  const cents = Math.round(price * 100);
  if (cents % 100 === 50) {
    price = (cents - 50) / 100;
  }

  // $16 → $15 for in-line pricing
  if (Math.abs(price - 16) < 0.001) {
    price = 15;
  }

  return price;
};

let priceOverrides = loadPriceOverrides ? loadPriceOverrides() : { items: {}, portions: {} };

/* --------------------------------------------------------------------------
 * Eligibility helpers
 *
 * Some mains come with a free side, while others (and sides themselves) do not.
 * Likewise, certain mains let the guest choose a sauce. Use sets to identify
 * these items for easy lookups when adding to the cart and rendering.
 */
// IDs of mains that allow a free side (all except burgers, patties, and KG Surprise)
const freeSideEligibleIds = new Set(
  mains
    .filter(item => !['beef_burgers', 'beef_patties', 'kg_mystery'].includes(item.id))
    .map(item => item.id)
);
// IDs of mains that allow sauce selection
const sauceEligibleIds = new Set([
  'beef_ribs', 'beef_burgers', 'chicken_wings', 'chicken_quarter',
  'snapper', 'tilapia', 'salmon',
  'chicken_kabobs', 'beef_kabobs', 'shrimp_kabobs',
]);
// Free side options (objects with id and display name) used in select lists
const freeSideChoices = [
  { id: 'jollof_rice', name: 'Jollof Rice' },
  { id: 'mac_cheese', name: 'Mac & Cheese' },
  { id: 'potato_wedges', name: 'Potato Wedges' },
];

// In-memory cart
const cart = [];

// ---------------------------------------------------------------------------
// Gamification: Grill Points & Upsell helpers
// ---------------------------------------------------------------------------

let grillPoints = 0;
let grillPointsLifetime = 0;

/**
 * Ensure the small bits of UI we need for gamification exist:
 * - Header Grill Points badge
 * - Cart upsell area
 * - Toast for quick feedback
 */
function ensureGamificationUI() {
  const headerInner = document.querySelector('.header-inner');
  if (headerInner && !document.getElementById('grillPointsBadge')) {
    const badge = document.createElement('div');
    badge.id = 'grillPointsBadge';
    badge.className = 'grill-points-badge';
    badge.innerHTML = '🔥 Grill Points: <span id="grillPointsValue">0</span>';
    headerInner.appendChild(badge);
  }

  const cartPanel = document.getElementById('cartPanel');
  if (cartPanel && !document.getElementById('cartUpsell')) {
    const footer = cartPanel.querySelector('.cart-footer');
    if (footer) {
      const upsell = document.createElement('div');
      upsell.id = 'cartUpsell';
      upsell.className = 'cart-upsell';
      cartPanel.insertBefore(upsell, footer);
    }
  }

  if (!document.getElementById('grillPointsToast')) {
    const t = document.createElement('div');
    t.id = 'grillPointsToast';
    t.className = 'grill-points-toast';
    document.body.appendChild(t);
  }
}

let grillPointsSyncInFlight = null;

function getLocalGrillPoints() {
  const saved = Number(localStorage.getItem('kg_grill_points') || '0');
  const savedLife = Number(localStorage.getItem('kg_grill_points_lifetime') || '0');
  return {
    points: Number.isFinite(saved) ? saved : 0,
    lifetime: Number.isFinite(savedLife) ? savedLife : 0,
  };
}

/**
 * Load Grill Points for this visitor.
 * 1) Try backend (/kg/grill-points, keyed by IP + R2 JSON).
 * 2) Fall back to localStorage if backend fails.
 */
async function loadGrillPoints() {
  // Try backend first
  try {
    const resp = await fetch(api('/grill-points'));
    if (resp.ok) {
      const data = await resp.json();
      const backendPoints = Number(data.points || 0);
      const backendLifetime = Number(data.lifetime || backendPoints || 0);

      grillPoints = Number.isFinite(backendPoints) ? backendPoints : 0;
      grillPointsLifetime = Number.isFinite(backendLifetime) ? backendLifetime : grillPoints;

      // Mirror into localStorage so it feels instant + works offline
      localStorage.setItem('kg_grill_points', String(grillPoints));
      localStorage.setItem('kg_grill_points_lifetime', String(grillPointsLifetime));

      updateGrillPointsUI();
      return;
    }
  } catch (err) {
    console.warn('Failed to load Grill Points from backend, using local values instead:', err);
  }

  // Fallback: just use local storage
  const local = getLocalGrillPoints();
  grillPoints = local.points;
  grillPointsLifetime = local.lifetime || local.points;
  updateGrillPointsUI();
}

/**
 * Save Grill Points:
 *  - Always write locally (instant feedback).
 *  - Fire-and-forget sync to backend (R2 via /kg/grill-points).
 */
function saveGrillPoints() {
  localStorage.setItem('kg_grill_points', String(grillPoints));
  localStorage.setItem('kg_grill_points_lifetime', String(grillPointsLifetime));
  syncGrillPointsToBackend();
}

async function syncGrillPointsToBackend() {
  if (grillPointsSyncInFlight) return grillPointsSyncInFlight;

  const payload = {
    points: grillPoints,
    lifetime: grillPointsLifetime,
    event: 'frontend_update',
  };

  grillPointsSyncInFlight = fetch(api('/grill-points'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .catch((err) => {
      console.warn('Failed to sync Grill Points to backend', err);
    })
    .finally(() => {
      grillPointsSyncInFlight = null;
    });

  return grillPointsSyncInFlight;
}


function updateGrillPointsUI() {
  const valEl = document.getElementById('grillPointsValue');
  if (valEl) {
    valEl.textContent = grillPoints;
  }
}

let grillToastTimeout;
function showGrillPointsToast(message) {
  const toast = document.getElementById('grillPointsToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(grillToastTimeout);
  grillToastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
  }, 2500);
}

/**
 * Grant points and update UI.
 */
function awardGrillPoints(points, reason) {
  if (!points || points <= 0) return;
  grillPoints += points;
  grillPointsLifetime += points;
  saveGrillPoints();
  updateGrillPointsUI();
  if (reason) {
    showGrillPointsToast(`+${points} Grill Points – ${reason}`);
  } else {
    showGrillPointsToast(`+${points} Grill Points`);
  }
}

/**
 * Simple rules for points per added item.
 * Big plates and fish give more.
 */
function awardGrillPointsForItem(item) {
  if (!item) return;
  let base = 10; // every add to cart feels rewarding
  if (item.price >= 20) base += 10; // big plate bonus
  if (['snapper', 'salmon', 'tilapia', 'beef_ribs'].includes(item.id)) {
    base += 10; // premium grill items
  }
  awardGrillPoints(base, `for adding ${item.name}`);
}

/**
 * Cart-level upsell suggestions.
 * Called from updateCartTotals(subtotal).
 */
function updateCartUpsell(subtotal) {
  const upsellEl = document.getElementById('cartUpsell');
  if (!upsellEl) return;

  if (!cart.length) {
    upsellEl.innerHTML = `
      <p class="cart-upsell-text">
        🔥 Start your order to begin earning Grill Points and unlock KG bonuses.
      </p>
    `;
    return;
  }

  const sideIds = ['jollof_rice', 'mac_cheese', 'potato_wedges'];
  const kabobIds = [
    'chicken_kabobs', 'beef_kabobs', 'shrimp_kabobs',
    'side_chicken_kabob', 'side_beef_kabob', 'side_shrimp_kabob',
  ];
  const mainIds = mains.map(m => m.id);

  const hasSide = cart.some(i => sideIds.includes(i.id));
  const hasKabob = cart.some(i => kabobIds.includes(i.id));
  const hasMain = cart.some(i => mainIds.includes(i.id));

  let html = '';

  if (hasMain && !hasSide) {
    // Push them to add a main side
    html = `
      <p class="cart-upsell-text">
        🍚 Level up your plate – add a side and earn bonus Grill Points.
      </p>
      <div class="cart-upsell-actions">
        <button type="button" class="cart-upsell-btn" data-upsell-id="jollof_rice">
          Add Jollof Rice ($6.50)
        </button>
        <button type="button" class="cart-upsell-btn" data-upsell-id="mac_cheese">
          Add Mac &amp; Cheese ($6.50)
        </button>
      </div>
    `;
  } else if (hasMain && !hasKabob) {
    // Push kabobs as fun add-ons
    html = `
      <p class="cart-upsell-text">
        🔥 KG just pulled kabobs off the grill. Add a couple skewers?
      </p>
      <div class="cart-upsell-actions">
        <button type="button" class="cart-upsell-btn" data-upsell-id="side_chicken_kabob">
          Add 1 Chicken Kabob ($3.50)
        </button>
        <button type="button" class="cart-upsell-btn" data-upsell-id="side_beef_kabob">
          Add 1 Beef Kabob ($3.50)
        </button>
      </div>
    `;
  } else if (subtotal < 40) {
    const diff = 40 - subtotal;
    html = `
      <p class="cart-upsell-text">
        🎯 Spend ${formatCurrency(diff)} more to hit the KG Bonus Zone –
        KG drops surprise extras and extra Grill Points for big orders.
      </p>
    `;
  } else {
    // High spend – offer KG Surprise
    html = `
      <p class="cart-upsell-text">
        🎁 Big plate energy! Add a KG Surprise Item for $4 and let KG
        throw something special from the grill in your box.
      </p>
      <div class="cart-upsell-actions">
        <button type="button" class="cart-upsell-btn" data-upsell-id="kg_mystery">
          Add KG Surprise ($4)
        </button>
      </div>
    `;
  }

  upsellEl.innerHTML = html;

  // Wire up buttons to actually add the upsell item(s)
  upsellEl.querySelectorAll('.cart-upsell-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-upsell-id');
      const allItems = mains.concat(sides);
      const item = allItems.find(i => i.id === id);
      if (!item) return;
      addToCart(item);
    });
  });
}


// Restaurant coordinates (approximate location near 5750 Baltimore Ave)
const restaurantCoords = { lat: 39.9448, lon: -75.2390 }; // ~58th & Baltimore
const INLINE_RADIUS_MILES = 1.0; // ordering distance from orgin
let userCoords = null;
let deliveryFee = 0;
let inMobileCheckout = false;
let inlinePreviewMode = false;

const ORDERING_STATUS_STORAGE_KEY = 'kgOrderingStatus';
const DEFAULT_CLOSED_MESSAGE = 'Sorry, we are currently closed. Please check back when we are open.';
let orderingClosed = false;
let orderingClosedMessage = DEFAULT_CLOSED_MESSAGE;

function readOrderingStatus() {
  try {
    const raw = localStorage.getItem(ORDERING_STATUS_STORAGE_KEY);
    if (!raw) return { closed: false, message: DEFAULT_CLOSED_MESSAGE };
    const parsed = JSON.parse(raw);
    return {
      closed: Boolean(parsed?.closed),
      message: parsed?.message || DEFAULT_CLOSED_MESSAGE,
    };
  } catch (err) {
    console.warn('Could not parse ordering status', err);
    return { closed: false, message: DEFAULT_CLOSED_MESSAGE };
  }
}

function applyOrderingStatus(status) {
  orderingClosed = !!status.closed;
  orderingClosedMessage = status.message || DEFAULT_CLOSED_MESSAGE;

  const banner = document.getElementById('orderingClosedBanner');
  const bannerMsg = document.getElementById('orderingClosedMessageText');
  if (banner && bannerMsg) {
    bannerMsg.textContent = orderingClosedMessage;
    banner.hidden = !orderingClosed;
  }

  const checkoutNote = document.getElementById('orderingClosedCheckoutNote');
  if (checkoutNote) {
    checkoutNote.textContent = orderingClosed
      ? `${orderingClosedMessage} Ordering is paused right now.`
      : '';
    checkoutNote.hidden = !orderingClosed;
  }

  document.body.classList.toggle('ordering-closed', orderingClosed);

  const buttons = document.querySelectorAll('.add-to-cart-btn, .cart-upsell-btn, #checkoutButton, #placeOrderButton, #stripeCheckoutBtn');
  buttons.forEach((btn) => {
    if (!btn) return;
    btn.disabled = orderingClosed || btn.classList.contains('inline-preview-disabled');
    btn.classList.toggle('ordering-closed-disabled', orderingClosed);
  });
}

function syncOrderingStatusFromStorage() {
  applyOrderingStatus(readOrderingStatus());
}

function ensureOrderingOpenOrWarn() {
  if (!orderingClosed) return true;
  alert(orderingClosedMessage);
  return false;
}


// Tip state. When delivery is selected, customers can optionally leave a tip. The
// tip can be a percentage (e.g. 0.15 for 15%) or a custom flat amount. The
// `currentTipPercent` is either a number (percentage) or the string 'custom'.
// `currentTipAmount` stores the dollar amount of the tip. These values are
// updated via the tip buttons and custom input.
let currentTipPercent = 0;
let currentTipAmount = 0;

// Stripe variables
let stripe = null;
let elements = null;
let cardElement = null;
let paymentRequest = null;
let paymentRequestButton = null;
let currentClientSecret = null;

/**
 * Compute the monetary breakdown for the current cart and fulfilment selection.
 * Returns an object with subtotal, fees, deliveryFee, tip and grand total.
 */
function computeTotals() {
  // Subtotal is sum of unit price × quantity for all cart items
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Determine order type
  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';

  // Service & tax: 0 for in-line / in-store, 10% for pickup / delivery
  let fees = 0;
  if (orderType !== 'inline') {
    setInlinePreviewMode(false);
  }

  // ✅ Delivery fee: ONLY for delivery
  const delivery = orderType === 'delivery' ? (deliveryFee || 0) : 0;

  // ✅ Tip: ONLY for delivery
  const tip = orderType === 'delivery' ? (currentTipAmount || 0) : 0;

  const total = subtotal + fees + delivery + tip;
  return { subtotal, fees, deliveryFee: delivery, tip, grand: total };
}


/* --------------------------------------------------------------------------
 * API base helper
 *
 * Many backend routes (such as /config, /create-payment-intent, /telegram-notify)
 * live on a separate domain (e.g. delcotechdivision.com) while this site is
 * served from a static host (e.g. kggrillkitchen.onrender.com). To avoid
 * hardcoding full URLs throughout the code, we look for a `kg-api-base`
 * meta tag or a global `KG_API_BASE` variable. If provided, it should be
 * the full origin (e.g. https://www.delcotechdivision.com) without a trailing
 * slash. The helper `api()` prepends this base to any path. If no base
 * is configured, it falls back to relative paths (same origin).
 */
const KG_META_API = document.querySelector('meta[name="kg-api-base"]');
let __apiBase = window.KG_API_BASE || (KG_META_API && KG_META_API.content) || '';
if (typeof __apiBase === 'string') {
  __apiBase = __apiBase.replace(/\/$/, '');
}
// Fall back to the Delco Tech base if no API base is provided.  We default
// to the KG router ("/kg") rather than the root of the domain.  This
// ensures that all API requests (config, analytics, payment, telegram) hit
// endpoints that are configured with CORS.  If you deploy your backend
// elsewhere, provide a meta tag `<meta name="kg-api-base" content="https://your.backend.com/kg">`.
// NOTE: Do not include a trailing slash in the base.
const API_BASE = __apiBase || 'https://www.delcotechdivision.com/kg';
function api(url) {
  return API_BASE ? `${API_BASE}${url}` : url;
}


/**
 * Format a number to USD currency.
 * @param {number} value
 */
function formatCurrency(value) {
  return '$' + value.toFixed(2);
}

/**
 * Compute the great circle distance between two lat/lon pairs in miles using
 * the haversine formula.
 */
function computeDistanceMiles(lat1, lon1, lat2, lon2) {
  const toRad = deg => deg * Math.PI / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = R * c;
  return distanceKm * 0.621371; // convert to miles
}

/**
 * Calculate a delivery fee based on distance. You can adjust base and per mile
 * to suit your needs.
 * @param {number} distanceMiles
 */
function computeDeliveryFee(distanceMiles) {
  const baseFee = 3.0;
  const perMile = 1.0;
  return baseFee + (distanceMiles * perMile);
}


/** Current fulfilment type helper */
function getCurrentOrderType() {
  return document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
}

/**
 * Get portion + price for a given item and option index / key,
 * automatically switching between online and inline pricing.
 */
function getPortionPriceForOrderType(itemId, portionKeyOrIndex, orderType) {
  const options = portionOptions[itemId];
  if (!options || !options.length) return null;

  let opt = null;
  if (typeof portionKeyOrIndex === 'number') {
    opt = options[portionKeyOrIndex] || options[0];
  } else if (typeof portionKeyOrIndex === 'string') {
    opt = options.find(o => o.key === portionKeyOrIndex) || options[0];
  } else {
    opt = options[0];
  }

  const pricing = getEffectivePricingForItem({ id: itemId }, opt.key);
  const price = pricing
    ? (orderType === 'inline' ? pricing.inline : pricing.online)
    : orderType === 'inline' && typeof opt.inlinePrice === 'number'
      ? opt.inlinePrice
      : opt.onlinePrice;

  return {
    opt: {
      ...opt,
      onlinePrice: pricing?.online ?? opt.onlinePrice,
      inlinePrice: pricing?.inline ?? opt.inlinePrice,
    },
    price,
  };
}

/**
 * Generic inline discount for items that do NOT use portionOptions.
 * - Always remove $0.50 from X.50 prices (21.50 → 21.00, 3.50 → 3.00).
 * - Special case: $16 → $15 for “$16 items should be $15 in-line”.
 */

function getEffectivePricingForItem(item, portionKey = null) {
  if (getEffectivePrices) {
    const pricing = getEffectivePrices(item.id, portionKey, priceOverrides);
    if (pricing) return pricing;
  }

  if (portionKey) {
    const opts = portionOptions[item.id] || [];
    const fallback = opts.find(o => o.key === portionKey) || opts[0] || null;
    if (fallback) {
      return {
        inline: fallback.inlinePrice,
        online: fallback.onlinePrice,
        markup: fallback.onlinePrice - fallback.inlinePrice,
      };
    }
    return null;
  }

  const inline = computeInlineBasePrice(item.price, item.id);
  return {
    inline,
    online: item.price,
    markup: item.price - inline,
  };
}


/**
 * Re-apply pricing whenever orderType changes:
 * - Update menu labels
 * - Update cart item prices
 */
function applyPricingForOrderType() {
  const orderType = getCurrentOrderType();
  const allItems = mains.concat(sides);

  // Update menu prices in the visible cards
  document.querySelectorAll('.menu-item').forEach(card => {
    const btn = card.querySelector('button[data-id]');
    const priceEl = card.querySelector('.price');
    if (!btn || !priceEl) return;

    const id = btn.getAttribute('data-id');
    const item = allItems.find(i => i.id === id);
    if (!item) return;

    const selectEl = card.querySelector('.portion-select[data-id="' + id + '"]');
    let displayPrice;

    if (selectEl && portionOptions[id]) {
      const index = parseInt(selectEl.value, 10) || 0;
      const result = getPortionPriceForOrderType(id, index, orderType);
      displayPrice = result ? result.price : item.price;
    } else {
      const pricing = getEffectivePricingForItem(item);
      displayPrice = pricing
        ? (orderType === 'inline' ? pricing.inline : pricing.online)
        : item.price;
    }

    priceEl.textContent = formatCurrency(displayPrice);
  });

  // Update cart item prices
  cart.forEach(ci => {
    const pricing = getEffectivePricingForItem(ci, ci.plateOptionKey || null);
    const baseOnline = pricing?.online ?? (typeof ci.baseOnlinePrice === 'number' ? ci.baseOnlinePrice : ci.price);
    const baseInline =
       pricing?.inline ??
      (typeof ci.baseInlinePrice === 'number'
        ? ci.baseInlinePrice
         : computeInlineBasePrice(baseOnline, ci.id));

    ci.baseOnlinePrice = baseOnline;
    ci.baseInlinePrice = baseInline;

    ci.price = orderType === 'inline' ? baseInline : baseOnline;
  });
}


/**
 * Render the menu cards for mains and sides into their respective
 * containers.
 */
function renderMenu() {
  const mainsContainer = document.getElementById('mains-container');
  const sidesContainer = document.getElementById('sides-container');

  // If this page doesn't have the menu containers (like line.html), just skip
  if (!mainsContainer || !sidesContainer) {
    return;
  }

  const allItems = mains.concat(sides);
  const orderType = getCurrentOrderType();

  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'menu-item';

    const hasPortions = !!portionOptions[item.id];

    let portionHtml = '';
    let displayPrice;

    if (hasPortions) {
      const result = getPortionPriceForOrderType(item.id, 0, orderType);
      displayPrice = result ? result.price : item.price;

      const options = portionOptions[item.id];
      portionHtml = `
        <label class="portion-label">
          Portion:
          <select class="portion-select" data-id="${item.id}">
            ${options
              .map((opt, idx) => {
                const pricing = getEffectivePricingForItem(item, opt.key);
                const p = pricing
                  ? (orderType === 'inline' ? pricing.inline : pricing.online)
                  : orderType === 'inline'
                    ? opt.inlinePrice
                    : opt.onlinePrice;
                return `<option value="${idx}">${opt.label} – ${formatCurrency(p)}</option>`;
              })
              .join('')}
          </select>
        </label>
      `;
    } else {
      const base = item.price;
      const pricing = getEffectivePricingForItem(item);
      displayPrice = pricing
        ? (orderType === 'inline' ? pricing.inline : pricing.online)
        : item.price;
    }

    card.innerHTML = `
      <img src="${item.image}" alt="${item.name}">
      <div class="menu-content">
        <h3>${item.name}</h3>
        <p>${item.description}</p>
        <div class="price" data-price-for="${item.id}">${formatCurrency(displayPrice)}</div>
        ${portionHtml}
         <button class="add-to-cart-btn" data-id="${item.id}">Add to Cart</button>
      </div>
    `;

    const btn = card.querySelector('button[data-id]');
    btn.addEventListener('click', () => {
      const portions = portionOptions[item.id];
      let selectedPortion = null;

      if (portions) {
        const selectEl = card.querySelector('.portion-select[data-id="' + item.id + '"]');
        const index = selectEl ? parseInt(selectEl.value, 10) || 0 : 0;
        const result = getPortionPriceForOrderType(item.id, index, getCurrentOrderType());
        selectedPortion = result ? result.opt : null;
      }

      addToCart(item, selectedPortion);
    });

    const selectEl = card.querySelector('.portion-select[data-id="' + item.id + '"]');
    if (selectEl && portionOptions[item.id]) {
      selectEl.addEventListener('change', (e) => {
        const index = parseInt(e.target.value, 10) || 0;
        const result = getPortionPriceForOrderType(item.id, index, getCurrentOrderType());
        if (!result) return;

        const priceEl = card.querySelector('.price[data-price-for="' + item.id + '"]');
        if (priceEl) {
          priceEl.textContent = formatCurrency(result.price);
        }
      });
    }

    return card;
  }

  mainsContainer.innerHTML = '';
  mains.forEach(item => mainsContainer.appendChild(createCard(item)));

  sidesContainer.innerHTML = '';
  sides.forEach(item => sidesContainer.appendChild(createCard(item)));
}


/**
 * Add an item to the cart and update UI.
 */
function addToCart(item, portionOption = null) {
  if (!ensureOrderingOpenOrWarn()) return;

  const orderType = getCurrentOrderType();

  const pricing = getEffectivePricingForItem(item, portionOption?.key || null);
  let baseOnlinePrice = pricing?.online ?? item.price;
  let baseInlinePrice = pricing?.inline ?? null;
  let plateOptionKey = null;
  let plateOptionLabel = null;
  let displayName = item.name;

  if (portionOption) {
    plateOptionKey = portionOption.key;
    plateOptionLabel = portionOption.label;
    displayName = `${item.name} – ${portionOption.label}`;
  } else {
    baseInlinePrice = baseInlinePrice ?? computeInlineBasePrice(baseOnlinePrice, item.id);
  }

  const effectivePrice =
    orderType === 'inline'
      ? (typeof baseInlinePrice === 'number' ? baseInlinePrice : baseOnlinePrice)
      : baseOnlinePrice;

  // Treat different plate options as separate line items
  const existing = cart.find(ci =>
    ci.id === item.id &&
    ((ci.plateOptionKey || null) === (plateOptionKey || null))
  );

  if (existing) {
    existing.quantity += 1;
    existing.price = effectivePrice;
    existing.baseOnlinePrice = baseOnlinePrice;
    existing.baseInlinePrice = baseInlinePrice;
  } else {
    const cartItem = {
      ...item,
      name: displayName,
      quantity: 1,
      price: effectivePrice,
      baseOnlinePrice,
      baseInlinePrice,
    };

    if (plateOptionKey) {
      cartItem.plateOptionKey = plateOptionKey;
      cartItem.plateOptionLabel = plateOptionLabel;
    }

    if (sauceEligibleIds.has(item.id)) {
      cartItem.sauce = 'none';
    }
    if (freeSideEligibleIds.has(item.id)) {
      cartItem.freeSide = freeSideChoices[0]?.id || '';
    }

    cart.push(cartItem);
  }

  // 🎮 Gamification: award Grill Points for every add (use original item)
  awardGrillPointsForItem(item);

  // Show cart and update UI
  openCart();
  renderCart();
  updateCartTotals();
  updateCartButton();
}

/**
 * Render the cart items and update totals.
 */
function renderCart() {
  const cartContainer = document.getElementById('cartItems');
  cartContainer.innerHTML = '';
  cart.forEach(item => {
    const row = document.createElement('div');
    row.className = 'cart-item';
    // Build the cart item row. Include optional selects for free sides and sauces
    let freeSideHTML = '';
    if (item.freeSide !== undefined) {
      // Generate options for free sides
      const opts = freeSideChoices.map(choice => {
        const selected = item.freeSide === choice.id ? 'selected' : '';
        return `<option value="${choice.id}" ${selected}>${choice.name}</option>`;
      }).join('');
      freeSideHTML = `
        <div class="free-side-select">
          <label>Free side:
            <select data-type="freeSide" data-id="${item.id}">
              <option value="" ${item.freeSide === '' ? 'selected' : ''}>None</option>
              ${opts}
            </select>
          </label>
        </div>
      `;
    }
    let sauceHTML = '';
    if (item.sauce !== undefined) {
      sauceHTML = `
        <div class="sauce-select">
          <label>Sauce:
            <select data-type="sauce" data-id="${item.id}">
              <option value="none" ${item.sauce === 'none' ? 'selected' : ''}>No sauce</option>
              <option value="mild" ${item.sauce === 'mild' ? 'selected' : ''}>Mild</option>
              <option value="hot" ${item.sauce === 'hot' ? 'selected' : ''}>Hot</option>
            </select>
          </label>
        </div>
      `;
    }
    row.innerHTML = `
      <img src="${item.image}" alt="${item.name}">
      <div class="cart-item-details">
        <h4>${item.name}</h4>
        <div class="quantity">
          <button data-action="decrease">−</button>
          <span>${item.quantity}</span>
          <button data-action="increase">+</button>
        </div>
        <div class="price">${formatCurrency(item.price * item.quantity)}</div>
        ${freeSideHTML}
        ${sauceHTML}
      </div>
    `;
    const [decreaseBtn, increaseBtn] = row.querySelectorAll('button');
    decreaseBtn.addEventListener('click', () => updateQuantity(item.id, -1));
    increaseBtn.addEventListener('click', () => updateQuantity(item.id, 1));
    // Attach change listeners for selects after they are added
    row.querySelectorAll('select[data-type="freeSide"]').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        const cartItem = cart.find(ci => ci.id === id);
        if (cartItem) {
          cartItem.freeSide = e.target.value;
        }
      });
    });
    row.querySelectorAll('select[data-type="sauce"]').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        const cartItem = cart.find(ci => ci.id === id);
        if (cartItem) {
          cartItem.sauce = e.target.value;
        }
      });
    });
    cartContainer.appendChild(row);
  });
  updateCartTotals();
  updateTipSection();
}

/**
 * Update item quantity in cart.
 */
function updateQuantity(itemId, delta) {
  const idx = cart.findIndex(ci => ci.id === itemId);
  if (idx >= 0) {
    cart[idx].quantity += delta;
    if (cart[idx].quantity <= 0) {
      cart.splice(idx, 1);
    }
    renderCart();
    updateCartButton();
  }
}

/**
 * Compute and update subtotal, delivery fee, fees and total. Also toggles the
 * visibility of delivery and fees rows in the cart.
 */
function updateCartTotals() {
  // Use the same totals helper everywhere so UI and backend stay in sync
  const totals = computeTotals();
  const subtotal = totals.subtotal;
  let total = totals.grand;

  // 🎮 Update cart-level upsell suggestions
  updateCartUpsell(subtotal);

  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';

  // Delivery fee row
  const deliveryRow = document.getElementById('deliveryRow');
  const deliveryFeeEl = document.getElementById('cartDeliveryFee');
  if (orderType === 'delivery' && totals.deliveryFee > 0) {
    deliveryRow.hidden = false;
    if (deliveryFeeEl) {
      deliveryFeeEl.textContent = formatCurrency(totals.deliveryFee);
    }
  } else {
    deliveryRow.hidden = true;
    if (deliveryFeeEl) {
      deliveryFeeEl.textContent = formatCurrency(0);
    }
  }

  // Service & tax row – HIDDEN for in-line / in-store
  const feesRow = document.getElementById('feesRow');
  const cartFees = document.getElementById('cartFees');
  if (orderType === 'inline' || subtotal === 0 || totals.fees <= 0) {
    if (feesRow) feesRow.hidden = true;
    if (cartFees) cartFees.textContent = formatCurrency(0);
  } else {
    if (feesRow) feesRow.hidden = false;
    if (cartFees) cartFees.textContent = formatCurrency(totals.fees);
  }

  const tipAmount = totals.tip || 0;

  // Update displayed subtotal and total
  document.getElementById('cartSubtotal').textContent = formatCurrency(subtotal);
  document.getElementById('cartTotal').textContent = formatCurrency(total);

  // Update PaymentRequest total for Apple Pay / Google Pay
  if (paymentRequest && typeof paymentRequest.update === 'function') {
    const displayItems = [];
    displayItems.push({ label: 'Subtotal', amount: Math.round(subtotal * 100) });

    if (orderType === 'delivery' && totals.deliveryFee > 0) {
      displayItems.push({
        label: 'Delivery fee',
        amount: Math.round(totals.deliveryFee * 100),
      });
    }

    // Only show Service & tax for pickup / delivery, never for in-line
    if (orderType !== 'inline' && totals.fees > 0) {
      displayItems.push({
        label: 'Service & tax',
        amount: Math.round(totals.fees * 100),
      });
    }

    if (tipAmount > 0) {
      displayItems.push({
        label: 'Tip',
        amount: Math.round(tipAmount * 100),
      });
    }

    paymentRequest.update({
      total: { label: 'KG Grill Kitchen', amount: Math.round(total * 100) },
      displayItems,
    });
  }

  // Recompute tip labels/percentages since totals changed
  updateTipSection();
}


/**
 * Update the tip section UI. When the order type is delivery and there are
 * items in the cart, this function shows the tip buttons, updates the
 * percentage buttons with dollar amounts based on the current subtotal,
 * fees and delivery fee, highlights the selected tip, toggles the custom
 * input visibility and updates the tip summary. If pickup is selected or
 * the cart is empty, the section is hidden and the tip values are reset.
 */
function updateTipSection() {
  const tipSection = document.getElementById('tipSection');
  if (!tipSection) return;
  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  // Hide tip section for pickup or empty cart
  if (orderType !== 'delivery' || cart.length === 0) {
    tipSection.hidden = true;
    currentTipPercent = 0;
    currentTipAmount = 0;
    const tipAmountEl = document.getElementById('tipAmount');
    if (tipAmountEl) tipAmountEl.textContent = formatCurrency(0);
    return;
  }
  tipSection.hidden = false;
  // Calculate base for percentage tips: subtotal + fees + delivery
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const fees = subtotal * 0.1;
  const base = subtotal + fees + (deliveryFee || 0);
  // Update button labels with dollar amounts
  document.querySelectorAll('.tip-button[data-tip-percent]').forEach(btn => {
    const pctAttr = btn.getAttribute('data-tip-percent');
    if (pctAttr === 'custom') {
      btn.textContent = 'Custom';
      return;
    }
    const pct = parseFloat(pctAttr);
    const amt = base * pct;
    btn.textContent = `${Math.round(pct * 100)}% (${formatCurrency(amt)})`;
    // Highlight selected button
    if (currentTipPercent === pct) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });
  // Handle custom tip UI
  const customContainer = document.getElementById('customTipContainer');
  if (currentTipPercent === 'custom') {
    customContainer.hidden = false;
    // Ensure the custom input reflects the current tip amount
    const input = document.getElementById('customTipInput');
    if (input && document.activeElement !== input) {
      input.value = currentTipAmount ? currentTipAmount.toFixed(2) : '';
    }
  } else {
    customContainer.hidden = true;
    // Deselect custom button if not selected
    document.querySelectorAll('.tip-button[data-tip-percent="custom"]').forEach(btn => btn.classList.remove('selected'));
  }
  // Update the tip summary
  const tipAmountEl = document.getElementById('tipAmount');
  if (tipAmountEl) {
    tipAmountEl.textContent = formatCurrency(currentTipAmount || 0);
  }
}

/**
 * Open the cart panel.
 * On mobile, change the header Cart button to "Continue shopping"
 * so the user can tap it to go back to the menu.
 */
function openCart() {
  const cartPanel = document.getElementById('cartPanel');
  cartPanel.classList.add('open');
  cartPanel.setAttribute('aria-hidden', 'false');

  const isMobile = window.matchMedia('(max-width: 600px)').matches;
  const headerCartBtn = document.getElementById('viewCartBtn');

  // NEW: on mobile, hide the main header so the cart can use full height
  if (isMobile) {
    document.body.classList.add('cart-open-mobile');
  }

  if (isMobile && headerCartBtn) {
    // Remember original label once
    if (!headerCartBtn.dataset.originalLabel) {
      headerCartBtn.dataset.originalLabel = headerCartBtn.textContent;
    }
    headerCartBtn.textContent = 'Continue shopping';
  }
}



/**
 * Close the cart panel.
 * On mobile, restore the header Cart button text and scroll back to the menu.
 */
function closeCart(scrollToMenu = false) {
  const cartPanel = document.getElementById('cartPanel');
  cartPanel.classList.remove('open');
  cartPanel.setAttribute('aria-hidden', 'true');

  // NEW: always remove the mobile cart-open class
  document.body.classList.remove('cart-open-mobile');

  const isMobile = window.matchMedia('(max-width: 600px)').matches;
  const headerCartBtn = document.getElementById('viewCartBtn');

  if (headerCartBtn) {
    const original = headerCartBtn.dataset.originalLabel || `Cart (0)`;
    headerCartBtn.textContent = original;
    // Always keep the count correct
    updateCartButton();
  }

  if (isMobile && scrollToMenu) {
    const menuTop =
      document.getElementById('main-menu') ||
      document.getElementById('menuTop') ||
      document.body;
    menuTop.scrollIntoView({ behavior: 'smooth' });
  }
}



function updateCartButton() {
  const btn = document.getElementById('viewCartBtn');
  if (!btn) return;

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const normalLabel = `Cart (${totalItems})`;

  // Save the "normal" label so other helpers can restore it if needed
  btn.dataset.originalLabel = normalLabel;

  const isMobile = window.innerWidth <= 600;

  // Cart drawer state
  const cartPanel = document.getElementById('cartPanel');
  const cartIsOpen =
    cartPanel && cartPanel.classList.contains('open');

  // While on mobile AND either:
  //  - the cart drawer is open, or
  //  - we're in the mobile checkout flow,
  // the button should read "Continue shopping".
  if (isMobile && (cartIsOpen || inMobileCheckout)) {
    btn.textContent = 'Continue shopping';
  } else {
    btn.textContent = normalLabel;
  }
}


/**
 * Save a field value to localStorage.
 */
function saveField(key, value) {
  if (value) {
    localStorage.setItem(key, value);
  }
}

/**
 * Load saved user details from localStorage.
 */
function loadSavedDetails() {
  const nameSaved = localStorage.getItem('kg_name');
  const phoneSaved = localStorage.getItem('kg_phone');
  const addressSaved = localStorage.getItem('kg_address');
  const orderTypeSaved = localStorage.getItem('kg_orderType');

  if (nameSaved) {
    document.getElementById('customerName').value = nameSaved;
  }
  if (phoneSaved) {
    document.getElementById('customerPhone').value = phoneSaved;
  }
  if (addressSaved) {
    document.getElementById('deliveryAddress').value = addressSaved;
  }
  if (orderTypeSaved) {
    const radio = document.querySelector(`input[name="orderType"][value="${orderTypeSaved}"]`);
    if (radio) radio.checked = true;
  }

  // If the saved preference is delivery and we have an address,
  // forward-geocode it so the map + delivery fee are ready.
  if (orderTypeSaved === 'delivery' && addressSaved) {
    geocodeAddressAndUpdate(addressSaved);
  }
}


/**
 * Get the user's current location and reverse geocode it to prefill the
 * delivery address. On success, also call showMapAndDistance().
 * IMPORTANT: only runs if the address box is empty so it never overwrites
 * what the user typed or what we loaded from localStorage.
 */
async function getLocationAndPrefill() {
  const addressField = document.getElementById('deliveryAddress');
  if (!addressField) return;

  // If user already has an address (typed OR loaded from localStorage),
  // do NOT override it with geolocation.
  if (addressField.value.trim()) {
    return;
  }

  if (!navigator.geolocation) {
    console.warn('Geolocation is not supported by this browser.');
    return;
  }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    userCoords = { lat: latitude, lon: longitude };
    // reverse geocode using Nominatim
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
      const data = await resp.json();
      const displayName = data.display_name || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      addressField.value = displayName;
      saveField('kg_address', displayName);
    } catch (err) {
      console.error('Reverse geocoding failed', err);
    }
    showMapAndDistance();
  }, (err) => {
    console.warn('Geolocation error:', err);
  });
}


/**
 * Show a Leaflet map connecting the restaurant and customer, compute distance,
 * update the delivery fee and summarise the distance. Recompute cart totals.
 */
function showMapAndDistance() {
  if (!userCoords) return;
  const mapContainer = document.getElementById('mapContainer');
  mapContainer.hidden = false;
  // Destroy existing map instance if present
  if (window.kgMap) {
    window.kgMap.remove();
  }
  const map = L.map('mapContainer').setView([userCoords.lat, userCoords.lon], 13);
  window.kgMap = map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  // Markers
  L.marker([restaurantCoords.lat, restaurantCoords.lon]).addTo(map).bindPopup('KG Grill Kitchen').openPopup();
  L.marker([userCoords.lat, userCoords.lon]).addTo(map).bindPopup('Your location').openPopup();
  // Line
  const lineColor = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#2e8b57';
  const polyline = L.polyline([
    [restaurantCoords.lat, restaurantCoords.lon],
    [userCoords.lat, userCoords.lon]
  ], { color: lineColor }).addTo(map);
  // Fit the map to show both the restaurant and customer and cap zoom so it
  // doesn’t zoom in too closely. The maxZoom prevents an overly zoomed map.
  map.fitBounds(polyline.getBounds(), { padding: [20, 20], maxZoom: 12 });
  // Compute distance & fee
  const distance = computeDistanceMiles(restaurantCoords.lat, restaurantCoords.lon, userCoords.lat, userCoords.lon);
  deliveryFee = computeDeliveryFee(distance);
  const etaMinutes = Math.round(distance * 2 + 10);
  document.getElementById('distanceSummary').textContent = `Distance: ${distance.toFixed(2)} miles. Delivery fee: ${formatCurrency(deliveryFee)}. Estimated delivery time: ${etaMinutes}–${etaMinutes + 10} mins.`;
  // Save computed fee in totals
  updateCartTotals();
}

/**
 * Toggle inline preview mode (user selected inline but is not nearby).
 * Applies greyscale styling, disables checkout buttons, and shows the
 * guidance banner about switching to pickup/delivery.
 */
function setInlinePreviewMode(enabled) {
  inlinePreviewMode = enabled;

  document.body.classList.toggle('inline-preview-mode', enabled);

  const warning = document.getElementById('inlinePreviewWarning');
  if (warning) {
    warning.hidden = !enabled;
  }

  const checkoutBtn = document.getElementById('checkoutButton');
  const placeOrderBtn = document.getElementById('placeOrderButton');
  const stripeCheckoutBtn = document.getElementById('stripeCheckoutBtn');

  [checkoutBtn, placeOrderBtn, stripeCheckoutBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = enabled;
    btn.classList.toggle('inline-preview-disabled', enabled);
  });
}


/**
 * For in-line/in-store orders, require the customer to be within
 * ~0.2 miles of the restaurant. Returns a Promise<boolean>.
 */
function requireInlineProximity(options = {}) {
  const { allowPreviewMode = false } = options;
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      alert('Location is required to use in-line ordering. Please enable location access or order at the counter.');
      return resolve(false);
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        userCoords = { lat: latitude, lon: longitude };

        const dMiles = computeDistanceMiles(
          userCoords.lat,
          userCoords.lon,
          restaurantCoords.lat,
          restaurantCoords.lon
        );

        if (dMiles <= INLINE_RADIUS_MILES) {
          setInlinePreviewMode(false);
          resolve(true);
        } else {
          alert('You appear to be outside the in-store radius. You can browse in preview mode, but you must be at the restaurant or switch to Pickup/Delivery to place an order.');
          setInlinePreviewMode(true);
          resolve(allowPreviewMode);
        }
      },
      (err) => {
        console.warn('Inline geolocation failed', err);
        alert('We could not read your location. Please enable GPS/location or order at the counter.');
        setInlinePreviewMode(false);
        resolve(false);
      }
    );
  });
}

/**
 * Update the delivery fields visibility based on selected order type. When
 * switching to delivery, attempt to prefill / geocode and compute fee, but
 * NEVER override a manually-entered or previously-saved address.
 */
function updateOrderType() {
  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const deliveryFields = document.getElementById('deliveryFields');
  const addressEl = document.getElementById('deliveryAddress');
  const inlineNoticeEl = document.getElementById('inlinePayNotice');
  const paymentFieldset = document.getElementById('paymentFieldset');
  const inlineDiscountBadge = document.getElementById('inlineDiscountBadge');

  if (orderType === 'delivery') {
    // Show delivery details
    deliveryFields.hidden = false;
    if (addressEl) addressEl.required = true;

    // 👉 ALWAYS (re)compute delivery fee when switching to delivery
    if (addressEl) {
      const addr = addressEl.value.trim();

      if (addr) {
        // We already have an address (typed or loaded from storage) –
        // geocode it and update distance + deliveryFee.
        geocodeAddressAndUpdate(addr);
      } else {
        // No address yet – try to use geolocation which will call
        // showMapAndDistance() and set deliveryFee.
        getLocationAndPrefill();
      }
    }
  } else {
    // Leaving delivery → hide fields and clear fee
    deliveryFields.hidden = true;
    if (addressEl) {
      addressEl.required = false;
    }
    document.getElementById('mapContainer').hidden = true;
    document.getElementById('distanceSummary').textContent = '';

    // ✅ IMPORTANT: zero out fee when not in delivery
    deliveryFee = 0;
    updateCartTotals();
  }

  // ---------------- Inline / in-store UI ----------------
  if (inlineNoticeEl) {
    inlineNoticeEl.hidden = orderType !== 'inline';
  }
  if (paymentFieldset) {
    // Hide payment section for inline orders
    paymentFieldset.hidden = orderType === 'inline';
  }
  if (inlineDiscountBadge) {
    inlineDiscountBadge.hidden = orderType !== 'inline';
  }

  // Update submit button label for inline orders
  const placeBtn = document.getElementById('placeOrderButton');
  if (placeBtn) {
    placeBtn.textContent =
      orderType === 'inline' ? 'Place in line' : 'Pay & place order';
  }

  // Persist selection
  saveField('kg_orderType', orderType);

  // Re-apply pricing and totals for the new fulfilment type
  applyPricingForOrderType();
  renderCart();
  updateTipSection();
  updateCartTotals();
}


/**
 * Forward-geocode a typed/saved address string, update userCoords, show map,
 * and recalculate delivery fee + totals.
 */
async function geocodeAddressAndUpdate(addressString) {
  // Normalize/boost address for Philly area
  let query = (addressString || '').trim();
  if (!query) return;

  // Turn "phila" into "Philadelphia"
  if (/phila\b/i.test(query) && !/philadelphia\b/i.test(query)) {
    query = query.replace(/phila\b/i, 'Philadelphia');
  }

  // Ensure "Philadelphia, PA" appears at least once
  if (!/philadelphia/i.test(query)) {
    if (query.length) query += ', ';
    query += 'Philadelphia, PA';
  }

  // Make sure there's a country for better results
  if (!/usa|united states/i.test(query)) {
    query += ', USA';
  }

  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}`
    );
    const data = await resp.json();

    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      const lat = parseFloat(first.lat);
      const lon = parseFloat(first.lon);

      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        userCoords = { lat, lon };
        showMapAndDistance(); // this will update the map + delivery fee
      } else {
        console.warn('Geocode result missing lat/lon', first);
      }
    } else {
      console.warn('No geocode result for address:', query);
    }
  } catch (err) {
    console.error('Forward geocoding failed', err);
  }
}

/**
 * Initialise Stripe and payment elements. Attempts to fetch a publishable key
 * from the backend at /config. If unavailable, falls back to a global
 * KG_STRIPE_PK variable defined by the integrator. Also sets up a
 * PaymentRequest object for Apple Pay / Google Pay if supported.
 */
async function initStripe() {
  let publishableKey = '';
  try {
    const resp = await fetch(api('/config'));
    if (resp.ok) {
      const data = await resp.json();
      // Support various response shapes from the backend. The KG router
      // returns { publishableKey } whereas the legacy endpoint returns
      // stripePublishableKey or stripePk.  Prefer publishableKey if present.
      publishableKey = data.publishableKey
        || data.stripePublishableKey
        || data.stripePk
        || '';
    }
  } catch (err) {
    console.warn('Failed to fetch Stripe config:', err);
  }
  if (!publishableKey && window.KG_STRIPE_PK) {
    publishableKey = window.KG_STRIPE_PK;
  }
  if (!publishableKey) {
    console.error('No Stripe publishable key provided. Payment will be disabled.');
    return;
  }

  // ---- Elements setup ----
  stripe = Stripe(publishableKey);
  elements = stripe.elements();

  // Card element
  cardElement = elements.create('card');
  cardElement.mount('#card-element');

  // ---- Apple Pay / Google Pay (Payment Request) ----
  // Start with a zero total; we'll keep it in sync from updateCartTotals().
  paymentRequest = stripe.paymentRequest({
    country: 'US',
    currency: 'usd',
    total: { label: 'KG Grill Kitchen', amount: 0 },
    requestPayerName: true,
    requestPayerEmail: true,
    requestPayerPhone: true,
    requestShipping: false, // shipping handled on backend
  });

  // When the wallet (Apple/Google Pay) provides a payment method:
  paymentRequest.on('paymentmethod', async (ev) => {
    try {
      // Ensure we have a PaymentIntent on the backend
      const clientSecret = await createPaymentIntent();
      if (!clientSecret) throw new Error('Could not create PaymentIntent');

      // Use your requested snippet here:
      const result = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: ev.paymentMethod.id,
        },
        { handleActions: false }
      );

      if (result.error) {
        ev.complete('fail');
        displayPaymentMessage(result.error.message || 'Payment failed');
        return;
      }

      // If additional actions are required (3DS), handle them
      if (result.paymentIntent && result.paymentIntent.status === 'requires_action') {
        const next = await stripe.confirmCardPayment(clientSecret);
        if (next.error) {
          ev.complete('fail');
          displayPaymentMessage(next.error.message || 'Payment failed');
          return;
        }
        if (next.paymentIntent && next.paymentIntent.status === 'succeeded') {
          ev.complete('success');
          await handleOrderSuccess(next.paymentIntent.id);
          return;
        }
      }

      // Normal success path
      if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
        ev.complete('success');
        await handleOrderSuccess(result.paymentIntent.id);
      } else {
        ev.complete('fail');
        displayPaymentMessage('Payment could not be completed.');
      }
    } catch (err) {
      ev.complete('fail');
      displayPaymentMessage(err.message || 'Payment error');
    }
  });

  // Mount the Payment Request button only if Apple/Google Pay is available
  try {
    const prButton = elements.create('paymentRequestButton', { paymentRequest });
    paymentRequest.canMakePayment().then(result => {
      const btnWrapper = document.getElementById('payment-request-button');
      if (!btnWrapper) return;
      if (result) {
        btnWrapper.hidden = false;
        prButton.mount('#payment-request-button');
      } else {
        btnWrapper.hidden = true;
      }
    }).catch(() => {
      const btnWrapper = document.getElementById('payment-request-button');
      if (btnWrapper) btnWrapper.hidden = true;
    });
  } catch (error) {
    console.warn('Error mounting PaymentRequestButton', error);
  }
}

async function submitInlineOrder() {
  const nameEl = document.getElementById('customerName');
  const phoneEl = document.getElementById('customerPhone');
  const notesEl = document.getElementById('orderNotes');

  const name  = (nameEl?.value || '').trim();
  const phone = (phoneEl?.value || '').trim();
  const notes = (notesEl?.value || '').trim();

  if (!name || !phone) {
    displayPaymentMessage('Please enter your name and phone so we can call you when your order is ready.');
    if (!name && nameEl) {
      nameEl.focus();
    } else if (!phone && phoneEl) {
      phoneEl.focus();
    }
    return false;
  }

  if (!cart.length) {
    displayPaymentMessage('Your cart is empty. Please add items.');
    return false;
  }

  if (inlinePreviewMode) {
    displayPaymentMessage('We can only place in-store orders when you are at KG Grill Kitchen. Choose Pickup/Delivery to order remotely.');
    return false;
  }

  // Double-check proximity before sending
  const nearbyOk = await requireInlineProximity();
  if (!nearbyOk) return false;

  const totals = computeTotals();

  const payload = {
    name,
    phone,
    notes,
    fulfilment: 'inline',
    items: cart.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPrice: Math.round(i.price * 100),
      sauce: i.sauce || null,
      freeSide: i.freeSide || null,
    })),
    subtotal: Math.round(totals.subtotal * 100),
    deliveryFee: 0,
    fees: Math.round((totals.fees || 0) * 100),
    total: Math.round(totals.grand * 100),
  };

  try {
    const res = await fetch(api('/line-order'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      console.error('Inline order failed', data);
      displayPaymentMessage('Could not submit in-line order. Please try again or order at the counter.');
      return false;
    }

    alert(`Thank you, ${name}! Your order has been sent to the kitchen.\nPlease pay at the cashier when your name is called.`);

    // Reset cart + UI
    cart = [];
    saveCart();
    renderCart();
    updateCartButton();
    updateCartTotals();
    closeCart(true);

    return true;
  } catch (err) {
    console.error('Inline order error', err);
    displayPaymentMessage('Could not submit in-line order. Please try again or order at the counter.');
    return false;
  }
}


/**
 * Create a PaymentIntent on the backend with current order details. Returns
 * the client secret on success. On failure, displays an error message.
 */
async function createPaymentIntent() {
  // Avoid duplicate creation if we already have a client secret
  if (currentClientSecret) return currentClientSecret;

  // Order/customer fields that already exist in your DOM
  const fulfilment = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const name = (document.getElementById('customerName')?.value || '').trim();
  const phone = (document.getElementById('customerPhone')?.value || '').trim();
  const line1 = (document.getElementById('deliveryAddress')?.value || '').trim();

  // Build totals once (grand must be >= $0.50 => 50 cents)
  const totals = computeTotals();

  // Flatten cart for metadata (prices in cents)
  const simplifiedCartArray = cart.map(i => ({
    name: i.name,
    unitPrice: Math.round(i.price * 100),
    quantity: i.quantity,
    // keep these if present so you see them in Telegram/metadata
    sauce: i.sauce || null,
    freeSide: i.freeSide || null,
  }));

  // Payload that matches your /kg/create-payment-intent route
  const payload = {
    amount: Math.round(totals.grand * 100),          // cents
    tip: Math.round((totals.tip || 0) * 100),        // cents
    fulfilment,                                       // "pickup" | "delivery"
    name,
    phone,
    address: {
      line1,                                         // you only collect a single line
      city: '',                                      // left blank (no fields on the page)
      postal_code: ''                                // left blank (no fields on the page)
    },
    cart: simplifiedCartArray
  };

  try {
    const resp = await fetch(api('/create-payment-intent'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || err.message || 'Failed to create payment intent');
    }
    const data = await resp.json();
    currentClientSecret = data.clientSecret;
    return currentClientSecret;
  } catch (err) {
    displayPaymentMessage(err.message || 'Unable to create payment intent');
    return null;
  }
}

/**
 * Display a message below the payment form for the user.
 */
function displayPaymentMessage(msg) {
  const el = document.getElementById('payment-message');
  el.textContent = msg;
  el.hidden = false;
}

/**
 * Hide the payment message.
 */
function clearPaymentMessage() {
  const el = document.getElementById('payment-message');
  el.textContent = '';
  el.hidden = true;
}

/**
 * Called when a payment is successful. Notifies the backend/Telegram and resets the cart.
 */
async function handleOrderSuccess(paymentIntentId) {
  const fulfilment = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const name = (document.getElementById('customerName')?.value || '').trim();
  const phone = (document.getElementById('customerPhone')?.value || '').trim();
  const line1 = (document.getElementById('deliveryAddress')?.value || '').trim();

  const totals = computeTotals();
  // totals: { subtotal, fees, deliveryFee, tip, grand }

  // Build Telegram-friendly order (all money in cents)
  const telegramOrder = {
    event: 'paid',
    // original "amount" field (total in cents)
    amount: Math.round(totals.grand * 100),

    name,
    phone,
    address: {
      line1,
      city: '',
      postal_code: ''
    },

    // Detailed breakdown (all cents)
    subtotal: Math.round(totals.subtotal * 100),
    deliveryFee: Math.round((totals.deliveryFee || 0) * 100),
    fees: Math.round((totals.fees || 0) * 100),
    tip: Math.round((totals.tip || 0) * 100),
    total: Math.round(totals.grand * 100),

    // Prefer `items` on backend, but keep `cart` for backward compatibility
    items: cart.map(i => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPrice: Math.round(i.price * 100), // cents
      sauce: i.sauce || null,
      freeSide: i.freeSide || null
    })),
    cart: cart.map(i => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: Math.round(i.price * 100),
      sauce: i.sauce || null,
      freeSide: i.freeSide || null
    })),

    fulfilment,
    paymentIntentId
  };

  // Fire-and-forget Telegram notify (don’t block UX)
  try {
    fetch(api('/telegram-notify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramOrder),
    });
  } catch (_) {}

  // Friendly confirmation
  alert(`Thank you, ${name}! Your order has been placed successfully.`);

  // Reset client state/UI
  cart.length = 0;
  renderCart();
  updateCartButton();
  closeCart();

  const overlay = document.getElementById('checkoutOverlay');
  if (overlay) {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  currentClientSecret = null;
  clearPaymentMessage();

  // NEW: make sure mobile checkout visuals are reset
  resetMobileCheckoutHeader();
}


function resetMobileCheckoutHeader() {
  inMobileCheckout = false;
  document.body.classList.remove('mobile-checkout-active');
  // Put the Cart button text back to normal
  updateCartButton();
}


/**
 * Initialise page event listeners.
 */
function initEventListeners() {

   /**
   * Start Stripe Checkout (hosted page with Apple Pay / wallets).
   * Sends the current cart (including fees, delivery, and tip) to the backend
   * and redirects to session.url.
   */
async function startStripeCheckout() {
  if (cart.length === 0) {
    alert('Your cart is empty. Please add items.');
    return;
  }

  const fulfilment =
    document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';

  // 🔐 Require basic customer info before allowing express checkout
  const nameInput = document.getElementById('customerName');
  const phoneInput = document.getElementById('customerPhone');
  const addressInput = document.getElementById('deliveryAddress');

  const name = (nameInput?.value || '').trim();
  const phone = (phoneInput?.value || '').trim();
  const addressLine1 = (addressInput?.value || '').trim();

  if (!name || !phone || (fulfilment === 'delivery' && !addressLine1)) {
    let msg = 'Please enter your name and phone number';
    if (fulfilment === 'delivery') {
      msg += ' and a delivery address';
    }
    msg += ' before checkout.';
    alert(msg);

    if (!name && nameInput) {
      nameInput.focus();
    } else if (!phone && phoneInput) {
      phoneInput.focus();
    } else if (fulfilment === 'delivery' && addressInput && !addressLine1) {
      addressInput.focus();
    }

    return;
  }

  // Use your existing totals helper so we stay in sync with the UI:
  // subtotal, fees (service+tax), deliveryFee, tip, grand
  const totals = computeTotals();
  const fees = totals.fees || 0;                 // service & tax in dollars
  const delivery = totals.deliveryFee || 0;      // delivery fee in dollars
  const tip = totals.tip || 0;                   // tip in dollars


    // Base cart: actual menu items (prices in cents)
    const simplifiedCart = cart.map(i => ({
      id: i.id,
      name: i.name,
      unitPrice: Math.round(i.price * 100), // cents
      quantity: i.quantity,
      sauce: i.sauce || null,
      freeSide: i.freeSide || null,
    }));

    // Add Delivery fee as its own line item (if any)
    const deliveryCents = Math.round(delivery * 100);
    if (deliveryCents > 0) {
      simplifiedCart.push({
        id: 'delivery_fee',
        name: 'Delivery fee',
        unitPrice: deliveryCents,
        quantity: 1,
      });
    }

    // Add Service & tax as its own line item (if any)
    const feesCents = Math.round(fees * 100);
    if (feesCents > 0) {
      simplifiedCart.push({
        id: 'service_tax',
        name: 'Service & tax',
        unitPrice: feesCents,
        quantity: 1,
      });
    }

const payload = {
  fulfilment,
  name,
  phone,
  address: {
    line1: addressLine1,
    city: '',
    postal_code: ''
  },
  // Tip still goes as a separate field so the backend can create a "Driver tip" line
  tipCents: Math.round(tip * 100),
  cart: simplifiedCart,
  successUrl: window.location.origin + '/thank-you.html',
  cancelUrl: window.location.href,
};


    try {
      const resp = await fetch(api('/create-checkout-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      if (!resp.ok || !data.url) {
        throw new Error(data.error || 'Failed to start checkout');
      }

      // Redirect to Stripe Checkout (this page has Apple Pay button)
      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      alert(err.message || 'Unable to start express checkout.');
    }
  }


  
// Cart open/close + "Continue shopping" on mobile checkout
const viewCartBtn = document.getElementById('viewCartBtn');
if (viewCartBtn) {
  viewCartBtn.addEventListener('click', () => {
    const isMobile = window.innerWidth <= 600;

    // 1) If we are in mobile CHECKOUT mode, treat this as "Continue shopping"
    if (inMobileCheckout && isMobile) {
      const overlay = document.getElementById('checkoutOverlay');
      if (overlay) {
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
      }

      // Restore header + Cart text
      resetMobileCheckoutHeader();

      // Scroll back to the menu so user can add more items
      const menuTop = document.getElementById('main-menu') || document.body;
      menuTop.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    // 2) If the CART DRAWER is already open on mobile,
    //    use this as "Continue shopping" (close + scroll to menu).
    const cartPanel = document.getElementById('cartPanel');
    if (isMobile && cartPanel && cartPanel.classList.contains('open')) {
      // closeCart(true) will also restore the "Cart (n)" label
      closeCart(true);
      return;
    }

    // 3) Normal behaviour: open the cart drawer
    if (cart.length === 0) {
      alert('Your cart is empty. Please add items.');
    } else {
      openCart();
    }
  });
}


  document.getElementById('closeCart').addEventListener('click', closeCart);

  // Continue shopping hides the cart panel but retains contents
  const continueBtn = document.getElementById('continueShoppingBtn');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      // Close the cart panel
      closeCart();

      // Scroll back to the menu so user can add more items
      const menuTop =
        document.getElementById('menuTop') ||
        document.getElementById('main-menu') ||
        document.body;

      menuTop.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Radio change
document.querySelectorAll('input[name="orderType"]').forEach((radio) => {
  radio.addEventListener('change', async (e) => {
    const value = e.target.value;

    if (value === 'inline') {
      const ok = await requireInlineProximity({ allowPreviewMode: true });
      if (!ok) {
                const pickupRadio = document.querySelector('input[name="orderType"][value="pickup"]');
        if (pickupRadio) {
          pickupRadio.checked = true;
        }
        updateOrderType();
        return;
      }
    }

    updateOrderType();
  });
});


// Overlay click to dismiss
document.getElementById('checkoutOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'checkoutOverlay') {
    const overlay = document.getElementById('checkoutOverlay');
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');

    // Always restore header + Cart label when leaving checkout
    resetMobileCheckoutHeader();
  }
});

  
// Checkout open
document.getElementById('checkoutButton').addEventListener('click', () => {
  if (!ensureOrderingOpenOrWarn()) return;

  if (cart.length === 0) {
    alert('Please add items to your cart before proceeding to checkout.');
    return;
  }

    if (inlinePreviewMode) {
    alert('In-store checkout is disabled until you are at the restaurant. Please switch to Pickup/Delivery to place an order.');
    return;
  }

  // Notify backend via Telegram when user initiates checkout
  try {
    const subtotalPreview = cart.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const feesPreview = subtotalPreview * 0.1;
    const totalPreview =
      subtotalPreview +
      (deliveryFee || 0) +
      feesPreview +
      (currentTipAmount || 0);

    const name = (document.getElementById('customerName')?.value || '').trim();
    const phone = (document.getElementById('customerPhone')?.value || '').trim();
    const line1 = (document.getElementById('deliveryAddress')?.value || '').trim();

    const previewOrder = {
      event: 'checkout_initiated',
      amount: Math.round(totalPreview * 100), // cents
      name,
      phone,
      address: {
        line1,
        city: '',
        postal_code: ''
      },
      cart: cart.map(item => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: Math.round(item.price * 100),
        sauce: item.sauce || null,
        freeSide: item.freeSide || null,
      })),
    };

    fetch(api('/telegram-notify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(previewOrder),
    });
  } catch (err) {
    console.warn('Failed to send checkout notification', err);
  }

  // Show checkout overlay
  const overlay = document.getElementById('checkoutOverlay');
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');

  // 🔹 MOBILE-ONLY VISUAL BEHAVIOUR
  if (window.innerWidth <= 600) {
    inMobileCheckout = true;
    document.body.classList.add('mobile-checkout-active');
  }

  // Cart button should ALWAYS say "Continue shopping" while checkout is open
  const headerCartBtn = document.getElementById('viewCartBtn');
  if (headerCartBtn) {
    if (!headerCartBtn.dataset.originalLabel) {
      headerCartBtn.dataset.originalLabel = headerCartBtn.textContent;
    }
    headerCartBtn.textContent = 'Continue shopping';
  }
});


  // Persist user input (null-safe)
  const nameInput = document.getElementById('customerName');
  if (nameInput) {
    nameInput.addEventListener('input', e => {
      saveField('kg_name', e.target.value);
    });
  }

  const phoneInput = document.getElementById('customerPhone');
  if (phoneInput) {
    phoneInput.addEventListener('input', e => {
      saveField('kg_phone', e.target.value);
    });
  }

  // Delivery address: manual entry overrides geo, and is saved
  const deliveryAddressInput = document.getElementById('deliveryAddress');
  if (deliveryAddressInput) {
    // Save as they type
    deliveryAddressInput.addEventListener('input', e => {
      saveField('kg_address', e.target.value);
    });

    // When they finish editing, geocode for delivery orders
    deliveryAddressInput.addEventListener('blur', e => {
      const value = e.target.value.trim();
      saveField('kg_address', value);

      const orderType =
        document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';

      if (orderType === 'delivery' && value) {
        geocodeAddressAndUpdate(value);
      }
    });
  }


  // Tip buttons
  document.querySelectorAll('.tip-button[data-tip-percent]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove selection from all buttons
      document.querySelectorAll('.tip-button').forEach(b => b.classList.remove('selected'));
      // Mark this button as selected
      btn.classList.add('selected');
      const pctAttr = btn.getAttribute('data-tip-percent');
      // Calculate base for percentage tips
      const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const fees = subtotal * 0.1;
      const base = subtotal + fees + (deliveryFee || 0);
      if (pctAttr === 'custom') {
        currentTipPercent = 'custom';
        // Show custom input container
        const customContainer = document.getElementById('customTipContainer');
        if (customContainer) customContainer.hidden = false;
        // Reset custom tip value to currentTipAmount or 0
        const input = document.getElementById('customTipInput');
        if (input && document.activeElement !== input) {
          input.value = currentTipAmount ? currentTipAmount.toFixed(2) : '';
        }
      } else {
        const pct = parseFloat(pctAttr);
        currentTipPercent = pct;
        currentTipAmount = base * pct;
        // Hide custom input container
        const customContainer = document.getElementById('customTipContainer');
        if (customContainer) customContainer.hidden = true;
      }
      updateCartTotals();
    });
  });
  // Custom tip input handler
  const customInput = document.getElementById('customTipInput');
  if (customInput) {
    customInput.addEventListener('input', e => {
      currentTipPercent = 'custom';
      const val = parseFloat(e.target.value);
      currentTipAmount = Number.isFinite(val) && val > 0 ? val : 0;
      updateCartTotals();
    });
  }

    // Express Checkout (Stripe-hosted page with Apple Pay / wallets)
  const stripeCheckoutBtn = document.getElementById('stripeCheckoutBtn');
  if (stripeCheckoutBtn) {
    stripeCheckoutBtn.addEventListener('click', async () => {
       if (!ensureOrderingOpenOrWarn()) return;

      if (cart.length === 0) {
        alert('Please add items to your cart before proceeding to checkout.');
        return;
      }
      await startStripeCheckout();
    });
  }

  // Form submission (card payment)
  // Form submission (card payment)
document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearPaymentMessage();

  if (!ensureOrderingOpenOrWarn()) return;

  const nameEl = document.getElementById('customerName');
  const phoneEl = document.getElementById('customerPhone');
  const addrEl  = document.getElementById('deliveryAddress');

  const name  = (nameEl?.value || '').trim();
  const phone = (phoneEl?.value || '').trim();
  const orderType =
    document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';

  if (!name || !phone || (orderType === 'delivery' && !addrEl?.value.trim())) {
    displayPaymentMessage('Please fill out all required fields.');
    if (!name && nameEl) {
      nameEl.focus();
    } else if (!phone && phoneEl) {
      phoneEl.focus();
    } else if (orderType === 'delivery' && addrEl && !addrEl.value.trim()) {
      addrEl.focus();
    }
    return;
  }

  // In-line / in-store: NO Stripe, pay at cashier
  if (orderType === 'inline') {
    const ok = await submitInlineOrder();
    return; // whether ok or not, we do not proceed to Stripe
  }

  // Normal paid orders: create PaymentIntent + confirm card
  const clientSecret = await createPaymentIntent();
  if (!clientSecret) return;

    // Confirm payment with card element (no shipping here – it’s set on the backend)
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: {
          name,
          phone,
        },
      },
    });

    if (error) {
      displayPaymentMessage(error.message || 'Payment failed');
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
      handleOrderSuccess(paymentIntent.id);
    }
  });

}

// ---------------------------------------------------------------------------
// Background music: rotate 3 tracks with mute toggle + fade in/out
// ---------------------------------------------------------------------------

const KG_MUSIC_TRACKS = [
  'audio/music_0.mp3',
  'audio/music_1.mp3',
  'audio/music_2.mp3',
];

let kgMusicAudio = null;
let kgMusicStarted = false;
let kgMusicMuted = false;
let kgMusicCurrentIndex = 0;
let kgMusicFadeIntervalId = null;

function kgPickRandomTrackIndex() {
  if (!KG_MUSIC_TRACKS.length) return 0;
  return Math.floor(Math.random() * KG_MUSIC_TRACKS.length);
}

function kgUpdateMusicToggleIcon() {
  const btn = document.getElementById('musicToggle');
  if (!btn) return;

  const isSilent =
    kgMusicMuted ||
    !kgMusicAudio ||
    kgMusicAudio.volume === 0;

  if (isSilent) {
    btn.classList.add('muted');
    btn.textContent = '🔇';
  } else {
    btn.classList.remove('muted');
    btn.textContent = '🔊';
  }
}

function kgFadeMusicVolume(targetVolume, durationMs) {
  if (!kgMusicAudio) return;

  if (kgMusicFadeIntervalId) {
    clearInterval(kgMusicFadeIntervalId);
    kgMusicFadeIntervalId = null;
  }

  const steps = 20;
  const stepTime = durationMs / steps;
  const start = kgMusicAudio.volume;
  const delta = targetVolume - start;
  let currentStep = 0;

  kgMusicFadeIntervalId = setInterval(() => {
    currentStep += 1;
    const progress = currentStep / steps;
    let next = start + delta * progress;

    if (next < 0) next = 0;
    if (next > 1) next = 1;

    if (kgMusicAudio) {
      kgMusicAudio.volume = next;
    }

    if (currentStep >= steps) {
      clearInterval(kgMusicFadeIntervalId);
      kgMusicFadeIntervalId = null;
      kgMusicMuted = targetVolume === 0;
      kgUpdateMusicToggleIcon();
    }
  }, stepTime);
}

function kgPlayTrackByIndex(index, fadeIn = true) {
  if (!KG_MUSIC_TRACKS.length) return;

  // Stop any existing audio
  if (kgMusicAudio) {
    kgMusicAudio.pause();
    kgMusicAudio = null;
  }

  kgMusicCurrentIndex = index % KG_MUSIC_TRACKS.length;
  const src = KG_MUSIC_TRACKS[kgMusicCurrentIndex];
  const audio = new Audio(src);
  kgMusicAudio = audio;

  audio.loop = false;

  // Start silent and fade in, unless muted
  if (kgMusicMuted) {
    audio.volume = 0;
  } else if (fadeIn) {
    audio.volume = 0;
  } else {
    audio.volume = 1;
  }

  audio.addEventListener('ended', () => {
    // When the song ends, go to the next track in sequence
    const nextIndex = (kgMusicCurrentIndex + 1) % KG_MUSIC_TRACKS.length;
    kgPlayTrackByIndex(nextIndex, true);
  });

  audio.play().catch(err => {
    console.warn('[KG music] autoplay blocked:', err);
  });

  if (!kgMusicMuted && fadeIn) {
    kgFadeMusicVolume(1, 800); // fade in ~0.8s
  }

  kgUpdateMusicToggleIcon();
}

function kgStartBackgroundMusic() {
  if (kgMusicStarted) return;
  kgMusicStarted = true;

  const randomIndex = kgPickRandomTrackIndex();
  kgPlayTrackByIndex(randomIndex, true);
}

function kgToggleMusicMute() {
  // If music hasn't started yet, start it on first tap instead of "muting"
  if (!kgMusicAudio) {
    kgStartBackgroundMusic();
    return;
  }

  const isSilent = kgMusicMuted || kgMusicAudio.volume === 0;

  if (isSilent) {
    // Fade back in
    kgFadeMusicVolume(1, 500);
  } else {
    // Fade out
    kgFadeMusicVolume(0, 500);
  }
}

function initBackgroundMusic() {
  const speakerBtn = document.getElementById('musicToggle');
  if (speakerBtn) {
    speakerBtn.addEventListener('click', kgToggleMusicMute);
    kgUpdateMusicToggleIcon();
  }

  // Start music on first real interaction (click / key press)
  const startHandler = () => {
    if (!kgMusicStarted) {
      kgStartBackgroundMusic();
    }
  };

  // We use once:true so this only fires the very first time
  window.addEventListener('click', startHandler, { once: true });
  window.addEventListener('keydown', startHandler, { once: true });
}

// ---------------------------------------------------------------------------


// Entry point
document.addEventListener('DOMContentLoaded', async () => {
  // Start splash timer – show for ~2 seconds
  const splash = document.getElementById('splashScreen');
  setTimeout(() => {
    if (splash) {
      splash.classList.add('hidden');        // triggers CSS fade-out
    }
    document.body.classList.remove('show-splash'); // reveals app-content
  }, 2000);

  // Normal app init
    syncOrderingStatusFromStorage();
  window.addEventListener('storage', (event) => {
    if (event.key === ORDERING_STATUS_STORAGE_KEY) {
      syncOrderingStatusFromStorage();
          } else if (event.key === PRICE_OVERRIDE_STORAGE_KEY) {
      priceOverrides = loadPriceOverrides ? loadPriceOverrides() : priceOverrides;
      applyPricingForOrderType();
      renderMenu();
      updateCartTotals();
      updateCartButton();
    }
  });

  renderMenu();
  syncOrderingStatusFromStorage();
  ensureGamificationUI();   // 🎮 create Grill Points badge, upsell area, toast
  syncOrderingStatusFromStorage();
  await loadGrillPoints();  // 🎮 load points from R2 (fallback to local)
  loadSavedDetails();
  updateOrderType();
  renderCart();
  updateCartButton();
  initEventListeners();
  initBackgroundMusic();    // 🔊 set up music & speaker toggle
  await initStripe();

});
