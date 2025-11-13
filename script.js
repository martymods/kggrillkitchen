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

// Menu definitions. Prices are in USD. Feel free to adjust as needed.
// Define mains with updated pricing. Each object may include additional
// properties for free side and sauce eligibility. Prices reflect the
// latest menu: most mains are $16 or higher, burgers and patties are
// lower, and fish dishes are premium priced.
const mains = [
  {
    id: 'beef_ribs',
    name: 'Beef Ribs',
    price: 25.0,
    description: 'Slow‑cooked ribs glazed with our signature BBQ sauce.',
    // Use the uploaded image for beef ribs
    image: '/pictures/beefRibs.jpeg',
  },
  {
    id: 'beef_burgers',
    name: 'Beef Burgers',
    price: 5.0,
    description: 'Juicy grilled burgers with fresh lettuce and tomato.',
    image: '/pictures/beefBurger.jpeg',
  },
  {
    id: 'beef_patties',
    name: 'Beef Patties',
    price: 3.0,
    description: 'Crispy golden beef patties with a flaky crust.',
    image: 'https://source.unsplash.com/featured/?beef-patties,empanada',
  },
  {
    id: 'chicken_wings',
    name: 'Chicken Wings',
    price: 16.0,
    description: 'Crisp fried wings tossed in your choice of sauce.',
    image: 'https://source.unsplash.com/featured/?chicken-wings',
  },
  {
    id: 'chicken_quarter',
    name: 'Chicken Quarter Legs',
    price: 16.0,
    description: 'Marinated and grilled chicken quarter legs.',
    image: 'https://source.unsplash.com/featured/?grilled-chicken',
  },
  {
    id: 'snapper',
    name: 'Snapper Fish',
    price: 26.0,
    description: 'Whole snapper lightly seasoned and fried to perfection.',
    image: '/pictures/snapperFish.jpeg',
  },
  {
    id: 'tilapia',
    name: 'Tilapia (w/ Head)',
    price: 26.0,
    description: 'Whole tilapia served with head, seasoned and roasted.',
    image: 'https://source.unsplash.com/featured/?tilapia',
  },
  {
    id: 'salmon',
    name: 'Salmon',
    price: 26.0,
    description: 'Pan‑seared salmon fillet with lemon herb butter.',
    image: '/pictures/salmon.jpeg',
  },
  {
    id: 'chicken_kabobs',
    name: 'Chicken Kabobs',
    price: 16.0,
    description: 'Skewered chicken with peppers and onions.',
    image: 'https://source.unsplash.com/featured/?chicken-kebab',
  },
  {
    id: 'beef_kabobs',
    name: 'Beef Kabobs',
    price: 16.0,
    description: 'Tender beef kabobs seasoned and grilled.',
    image: 'https://source.unsplash.com/featured/?beef-kebab',
  },
  {
    id: 'shrimp_kabobs',
    name: 'Shrimp Kabobs',
    price: 16.0,
    description: 'Grilled shrimp skewers with garlic butter.',
    image: '/pictures/shrimpKabobs.jpeg',
  },
];

// Define side dishes. Most sides are priced at $6.50, except Cassava Leaf
// which is a premium dish. Additional small side portions (one wing or
// single kabob) are available at $3.50 each.
const sides = [
  {
    id: 'jollof_rice',
    name: 'Jollof Rice',
    price: 6.5,
    description: 'West African seasoned rice cooked in a rich tomato sauce.',
    image: 'https://source.unsplash.com/featured/?jollof-rice',
  },
  {
    id: 'mac_cheese',
    name: 'Mac & Cheese',
    price: 6.5,
    description: 'Creamy macaroni baked with cheddar cheese.',
    image: '/pictures/macandcheese.jpeg',
  },
  {
    id: 'potato_wedges',
    name: 'Potato Wedges',
    price: 6.5,
    description: 'Seasoned potato wedges fried until crispy.',
    image: '/pictures/potatoWedges.jpeg',
  },
  {
    id: 'cassava_leaf',
    name: 'Cassava Leaf',
    price: 16.0,
    description: 'Traditional Liberian stew made with cassava leaves.',
    image: 'https://source.unsplash.com/featured/?cassava-leaves',
  },
  {
    id: 'potato_greens',
    name: 'Potato Greens & White Rice',
    price: 6.5,
    description: 'Savory potato greens served with fluffy white rice.',
    image: 'https://source.unsplash.com/featured/?potato-greens',
  },
  // Additional sides consisting of single pieces priced at $3.50 each
  {
    id: 'side_chicken_wing',
    name: 'Chicken Wing (1 piece)',
    price: 3.5,
    description: 'A single chicken wing as a tasty side.',
    image: 'https://source.unsplash.com/featured/?single-chicken-wing',
  },
  {
    id: 'side_chicken_kabob',
    name: 'Chicken Kabob (1 piece)',
    price: 3.5,
    description: 'One skewer of chicken kabob as a side.',
    image: 'https://source.unsplash.com/featured/?single-chicken-kebab',
  },
  {
    id: 'side_beef_kabob',
    name: 'Beef Kabob (1 piece)',
    price: 3.5,
    description: 'One skewer of beef kabob as a side.',
    image: 'https://source.unsplash.com/featured/?single-beef-kebab',
  },
  {
    id: 'side_shrimp_kabob',
    name: 'Shrimp Kabob (1 piece)',
    price: 3.5,
    description: 'One skewer of shrimp kabob as a side.',
    image: 'https://source.unsplash.com/featured/?single-shrimp-kebab',
  },
];

/* --------------------------------------------------------------------------
 * Eligibility helpers
 *
 * Some mains come with a free side, while others (and sides themselves) do not.
 * Likewise, certain mains let the guest choose a sauce. Use sets to identify
 * these items for easy lookups when adding to the cart and rendering.
 */
// IDs of mains that allow a free side (all except burgers and patties)
const freeSideEligibleIds = new Set(
  mains
    .filter(item => !['beef_burgers', 'beef_patties'].includes(item.id))
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

// Restaurant coordinates (approximate location in Philadelphia)
const restaurantCoords = { lat: 39.9526, lon: -75.1652 };
let userCoords = null;
let deliveryFee = 0;

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
  // Service & tax: simple 10% of subtotal for this demo
  const fees = subtotal * 0.1;
  // Delivery fee: use precomputed deliveryFee when order type is delivery
  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const delivery = orderType === 'delivery' ? (deliveryFee || 0) : 0;
  // Tip amount: if pickup, tip is always 0
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

/**
 * Render the menu cards for mains and sides into their respective
 * containers.
 */
function renderMenu() {
  const mainsContainer = document.getElementById('mains-container');
  const sidesContainer = document.getElementById('sides-container');
  function createCard(item) {
    const card = document.createElement('div');
    card.className = 'menu-item';
    card.innerHTML = `
      <img src="${item.image}" alt="${item.name}">
      <div class="menu-content">
        <h3>${item.name}</h3>
        <p>${item.description}</p>
        <div class="price">${formatCurrency(item.price)}</div>
        <button data-id="${item.id}">Add to Cart</button>
      </div>
    `;
    card.querySelector('button').addEventListener('click', () => addToCart(item));
    return card;
  }
  mains.forEach(item => mainsContainer.appendChild(createCard(item)));
  sides.forEach(item => sidesContainer.appendChild(createCard(item)));
}

/**
 * Add an item to the cart and update UI.
 */
function addToCart(item) {
  const existing = cart.find(ci => ci.id === item.id);
  if (existing) {
    // Increase quantity if the item is already in the cart
    existing.quantity += 1;
  } else {
    // Create a new cart item with optional sauce/free side fields
    const cartItem = { ...item, quantity: 1 };
    if (sauceEligibleIds.has(item.id)) {
      cartItem.sauce = 'none';
    }
    if (freeSideEligibleIds.has(item.id)) {
      // Default free side to Jollof Rice (first choice)
      cartItem.freeSide = freeSideChoices[0]?.id || '';
    }
    cart.push(cartItem);
  }
  // Show cart and update UI
  openCart();
  renderCart();
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
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  let total = subtotal;
  // Determine order type
  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  // Delivery fee
  const deliveryRow = document.getElementById('deliveryRow');
  const deliveryFeeEl = document.getElementById('cartDeliveryFee');
  if (orderType === 'delivery' && deliveryFee > 0) {
    deliveryRow.hidden = false;
    deliveryFeeEl.textContent = formatCurrency(deliveryFee);
    total += deliveryFee;
  } else {
    deliveryRow.hidden = true;
  }
  // Basic estimate for service fee and tax (e.g. 10% combined)
  const feesRow = document.getElementById('feesRow');
  const cartFees = document.getElementById('cartFees');
  const fees = subtotal * 0.1;
  if (subtotal > 0) {
    feesRow.hidden = false;
    cartFees.textContent = formatCurrency(fees);
    total += fees;
  } else {
    feesRow.hidden = true;
  }
  // Include tip in total if applicable
  const tipAmount = currentTipAmount || 0;
  total += tipAmount;
  // Update displayed subtotal and total
  document.getElementById('cartSubtotal').textContent = formatCurrency(subtotal);
  document.getElementById('cartTotal').textContent = formatCurrency(total);
  // Update PaymentRequest total for Apple Pay/Google Pay
  if (paymentRequest && typeof paymentRequest.update === 'function') {
    const displayItems = [];
    displayItems.push({ label: 'Subtotal', amount: Math.round(subtotal * 100) });
    if (orderType === 'delivery' && deliveryFee > 0) {
      displayItems.push({ label: 'Delivery fee', amount: Math.round(deliveryFee * 100) });
    }
    if (subtotal > 0) {
      displayItems.push({ label: 'Service & tax', amount: Math.round(fees * 100) });
    }
    if (tipAmount > 0) {
      displayItems.push({ label: 'Tip', amount: Math.round(tipAmount * 100) });
    }
    paymentRequest.update({
      total: { label: 'KG Grill Kitchen', amount: Math.round(total * 100) },
      displayItems,
    });
  }

  // Update the tip UI now that totals may have changed. This recalculates
  // percentage tip amounts and refreshes button labels and the summary.
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
 */
function openCart() {
  document.getElementById('cartPanel').classList.add('open');
  document.getElementById('cartPanel').setAttribute('aria-hidden', 'false');
}

/**
 * Close the cart panel.
 */
function closeCart() {
  document.getElementById('cartPanel').classList.remove('open');
  document.getElementById('cartPanel').setAttribute('aria-hidden', 'true');
}

/**
 * Update the cart button label with the total quantity of items.
 */
function updateCartButton() {
  const btn = document.getElementById('viewCartBtn');
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  btn.textContent = `Cart (${totalItems})`;
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
}

/**
 * Get the user's current location and reverse geocode it to prefill the
 * delivery address. On success, also call showMapAndDistance().
 */
async function getLocationAndPrefill() {
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
      const addressField = document.getElementById('deliveryAddress');
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
 * Update the delivery fields visibility based on selected order type. When
 * switching to delivery, attempt to prefill address and compute fee.
 */
function updateOrderType() {
  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const deliveryFields = document.getElementById('deliveryFields');
  if (orderType === 'delivery') {
    deliveryFields.hidden = false;
    // Mark address as required
    document.getElementById('deliveryAddress').required = true;
    // get location and compute map once
    getLocationAndPrefill();
  } else {
    deliveryFields.hidden = true;
    document.getElementById('deliveryAddress').required = false;
    document.getElementById('mapContainer').hidden = true;
    document.getElementById('distanceSummary').textContent = '';
    deliveryFee = 0;
    updateCartTotals();
  }
  // Persist selection
  saveField('kg_orderType', orderType);
  // Update tip UI when order type changes
  updateTipSection();
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

  // Build Telegram-friendly order (amount in cents, include items)
  const telegramOrder = {
    event: 'paid',
    amount: Math.round(totals.grand * 100), // cents
    name,
    phone,
    address: {
      line1,
      city: '',
      postal_code: ''
    },
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

  document.getElementById('checkoutOverlay').classList.remove('show');
  document.getElementById('checkoutOverlay').setAttribute('aria-hidden', 'true');

  currentClientSecret = null;
  clearPaymentMessage();
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


  
  // Cart open/close
  document.getElementById('viewCartBtn').addEventListener('click', () => {
    if (cart.length === 0) {
      alert('Your cart is empty. Please add items.');
    } else {
      openCart();
    }
  });
  document.getElementById('closeCart').addEventListener('click', closeCart);

  // Continue shopping hides the cart panel but retains contents
  const continueBtn = document.getElementById('continueShoppingBtn');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      closeCart();
    });
  }
  // Radio change
  document.querySelectorAll('input[name="orderType"]').forEach(radio => {
    radio.addEventListener('change', updateOrderType);
  });
  // Checkout open
  document.getElementById('checkoutButton').addEventListener('click', () => {
    if (cart.length === 0) {
      alert('Please add items to your cart before proceeding to checkout.');
      return;
    }
    // Notify backend via Telegram when user initiates checkout
    try {
      const subtotalPreview = cart.reduce((sum, it) => sum + it.price * it.quantity, 0);
      const feesPreview = subtotalPreview * 0.1;
      const totalPreview = subtotalPreview + (deliveryFee || 0) + feesPreview + (currentTipAmount || 0);
      const previewOrder = {
        event: 'checkout_initiated',
        items: cart.map(item => ({ id: item.id, quantity: item.quantity, sauce: item.sauce || null, freeSide: item.freeSide || null })),
        total: totalPreview,
        tip: currentTipAmount || 0,
      };
      fetch(api('/telegram-notify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewOrder),
      });
    } catch (err) {
      console.warn('Failed to send checkout notification', err);
    }
    document.getElementById('checkoutOverlay').classList.add('show');
    document.getElementById('checkoutOverlay').setAttribute('aria-hidden', 'false');
  });
  // Overlay click to dismiss
  document.getElementById('checkoutOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'checkoutOverlay') {
      document.getElementById('checkoutOverlay').classList.remove('show');
      document.getElementById('checkoutOverlay').setAttribute('aria-hidden', 'true');
    }
  });
  // Persist user input
  document.getElementById('customerName').addEventListener('input', e => saveField('kg_name', e.target.value));
  document.getElementById('customerPhone').addEventListener('input', e => saveField('kg_phone', e.target.value));
  document.getElementById('deliveryAddress').addEventListener('input', e => saveField('kg_address', e.target.value));

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

    // Basic form validation
    const name = document.getElementById('customerName').value.trim();
    const phone = document.getElementById('customerPhone').value.trim();
    const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
    if (!name || !phone || (orderType === 'delivery' && !document.getElementById('deliveryAddress').value.trim())) {
      displayPaymentMessage('Please fill out all required fields.');
      return;
    }

    // Create PaymentIntent if not already done
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

// Entry point
document.addEventListener('DOMContentLoaded', async () => {
  renderMenu();
  loadSavedDetails();
  updateOrderType();
  renderCart();
  updateCartButton();
  initEventListeners();
  await initStripe();
});
