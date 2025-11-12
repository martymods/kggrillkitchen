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
    image: 'https://source.unsplash.com/featured/?beef-ribs,bbq',
  },
  {
    id: 'beef_burgers',
    name: 'Beef Burgers',
    price: 5.0,
    description: 'Juicy grilled burgers with fresh lettuce and tomato.',
    image: 'https://source.unsplash.com/featured/?burger,grill',
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
    image: 'https://source.unsplash.com/featured/?snapper-fish',
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
    image: 'https://source.unsplash.com/featured/?salmon',
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
    image: 'https://source.unsplash.com/featured/?shrimp-kebab',
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
    image: 'https://source.unsplash.com/featured/?mac-and-cheese',
  },
  {
    id: 'potato_wedges',
    name: 'Potato Wedges',
    price: 6.5,
    description: 'Seasoned potato wedges fried until crispy.',
    image: 'https://source.unsplash.com/featured/?potato-wedges',
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

// Stripe variables
let stripe = null;
let elements = null;
let cardElement = null;
let paymentRequest = null;
let paymentRequestButton = null;
let currentClientSecret = null;

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
// Fall back to the Delco Tech base if no API base is provided. This allows the
// site to call the backend at www.delcotechdivision.com by default. If you
// deploy your backend elsewhere, set the kg-api-base meta tag accordingly.
const API_BASE = __apiBase || 'https://www.delcotechdivision.com';
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
      cartItem.freeSide = '';
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
  document.getElementById('cartSubtotal').textContent = formatCurrency(subtotal);
  document.getElementById('cartTotal').textContent = formatCurrency(total);
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
  map.fitBounds(polyline.getBounds(), { padding: [20, 20], maxZoom: 14 });
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
      publishableKey = data.stripePublishableKey || data.stripePk || '';
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
  stripe = Stripe(publishableKey);
  elements = stripe.elements();
  // Mount the card element
  cardElement = elements.create('card');
  cardElement.mount('#card-element');
  // PaymentRequest for Apple Pay / Google Pay
  paymentRequest = stripe.paymentRequest({
    country: 'US',
    currency: 'usd',
    total: { label: 'KG Grill Kitchen', amount: 0 },
    requestPayerName: true,
    requestPayerEmail: true,
    requestPayerPhone: true,
    requestShipping: true,
  });
  paymentRequest.on('paymentmethod', async (ev) => {
    try {
      // Ensure we have a client secret
      const clientSecret = await createPaymentIntent();
      if (!clientSecret) throw new Error('Could not create PaymentIntent');
      // Confirm the payment using the wallet payment method
      const { paymentIntent, error } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: ev.paymentMethod.id,
        shipping: {
          name: document.getElementById('customerName').value,
          phone: document.getElementById('customerPhone').value,
          address: {
            line1: document.getElementById('deliveryAddress').value || '',
            city: '',
            state: '',
            postal_code: '',
            country: 'US',
          },
        },
        receipt_email: null,
      }, { handleActions: false });
      if (error) {
        ev.complete('fail');
        displayPaymentMessage(error.message || 'Payment failed');
      } else {
        ev.complete('success');
        handleOrderSuccess(paymentIntent.id);
      }
    } catch (err) {
      ev.complete('fail');
      displayPaymentMessage(err.message || 'Payment error');
    }
  });
  // Always mount a payment request button to allow Apple Pay / Google Pay. Even
  // if canMakePayment() returns false, Stripe will handle the user agent
  // gracefully. This surfaces Apple Pay when available.
  const prButton = elements.create('paymentRequestButton', { paymentRequest });
  document.getElementById('payment-request-button').hidden = false;
  prButton.mount('#payment-request-button');
}

/**
 * Create a PaymentIntent on the backend with current order details. Returns
 * the client secret on success. On failure, displays an error message.
 */
async function createPaymentIntent() {
  // Avoid duplicate creation if we already have a client secret
  if (currentClientSecret) return currentClientSecret;
  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const name = document.getElementById('customerName').value;
  const phone = document.getElementById('customerPhone').value;
  const address = document.getElementById('deliveryAddress').value;
  // Build payload with items and extras
  const items = cart.map(item => ({
    id: item.id,
    name: item.name,
    unitPrice: Math.round(item.price * 100),
    quantity: item.quantity,
    sauce: item.sauce || null,
    freeSide: item.freeSide || null,
  }));
  const payload = {
    items,
    currency: 'usd',
    orderType,
    name,
    phone,
    address,
    deliveryCents: Math.round(deliveryFee * 100),
  };
  try {
    const resp = await fetch(api('/create-payment-intent'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to create payment intent');
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
 * Called when a payment is successful. Notifies the backend, sends
 * Telegram notification and resets the cart.
 */
async function handleOrderSuccess(paymentIntentId) {
  // Build order summary
  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const name = document.getElementById('customerName').value;
  const phone = document.getElementById('customerPhone').value;
  const address = document.getElementById('deliveryAddress').value;
  const order = {
    orderType,
    name,
    phone,
    address,
    items: cart.map(item => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.price,
      sauce: item.sauce || null,
      freeSide: item.freeSide || null,
    })),
    deliveryFee,
    paymentIntentId,
  };
  // Notify backend / Telegram (non‑blocking)
  try {
    fetch(api('/telegram-notify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });
  } catch (err) {
    console.warn('Failed to notify Telegram:', err);
  }
  // Show thank you alert
  alert(`Thank you, ${name}! Your order has been placed successfully.`);
  // Clear cart and reset UI
  cart.length = 0;
  renderCart();
  updateCartButton();
  closeCart();
  document.getElementById('checkoutOverlay').classList.remove('show');
  document.getElementById('checkoutOverlay').setAttribute('aria-hidden', 'true');
  // Reset form fields but keep saved ones
  currentClientSecret = null;
  clearPaymentMessage();
}

/**
 * Initialise page event listeners.
 */
function initEventListeners() {
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
      const previewOrder = {
        event: 'checkout_initiated',
        items: cart.map(item => ({ id: item.id, quantity: item.quantity, sauce: item.sauce || null, freeSide: item.freeSide || null })),
        total: cart.reduce((sum, it) => sum + it.price * it.quantity, 0) + (deliveryFee || 0),
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
    // Confirm payment with card element
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: {
          name,
          phone,
        },
      },
      shipping: orderType === 'delivery' ? {
        name,
        phone,
        address: {
          line1: document.getElementById('deliveryAddress').value,
          country: 'US',
        },
      } : undefined,
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