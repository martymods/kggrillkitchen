/*
 * KG Grill Kitchen front-end script
 *
 * This script powers the interactive ordering experience for KG Grill Kitchen. It
 * renders the menu, manages a cart with optional sauce and free side
 * selections, calculates delivery fees, service/tax, tips and totals, and
 * integrates with Stripe for card and wallet payments (Apple Pay/Google Pay).
 * The API base and Stripe publishable key can be configured via meta tags:
 *   <meta name="kg-api-base" content="https://www.delcotechdivision.com/kg">
 *   <meta name="kg-stripe-pk" content="pk_live_...">
 * If the Stripe key is not provided, the script will attempt to call
 * `${apiBase}/config` to retrieve it. All backend calls (create-payment-intent,
 * telegram-notify, analytics) are prefixed with `apiBase`.
 */

(function() {
  // Read API base and Stripe PK from meta tags or fall back to defaults
  function getMeta(name) {
    const tag = document.querySelector(`meta[name="${name}"]`);
    return tag ? tag.content.trim() : '';
  }
  // Determine API base: prefer meta, then global var, then default to DelcoTech KG router
  let apiBase = getMeta('kg-api-base') || (typeof window !== 'undefined' && window.KG_API_BASE) || '';
  if (!apiBase) {
    apiBase = 'https://www.delcotechdivision.com/kg';
  }
  apiBase = apiBase.replace(/\/$/, '');
  // Determine Stripe publishable key: prefer meta, then global var
  let stripePk = getMeta('kg-stripe-pk') || (typeof window !== 'undefined' && window.KG_STRIPE_PK) || '';

  // Helper to prefix paths with API base
  function api(path) {
    return `${apiBase}${path}`;
  }

  // Menu definitions with images (replace unsplash placeholders with real photos where provided)
  const menuData = [
    // Mains
    { id: 'beef_ribs', name: 'Beef Ribs', price: 25.0, image: '/pictures/beefRibs.jpeg', description: 'Slow‑cooked ribs glazed with our signature BBQ sauce.' },
    { id: 'beef_burgers', name: 'Beef Burgers', price: 5.0, image: '/pictures/beefBurger.jpeg', description: 'Juicy grilled burgers with fresh lettuce and tomato.' },
    { id: 'beef_patties', name: 'Beef Patties', price: 3.0, image: '/pictures/beefBurger.jpeg', description: 'Crispy golden beef patties with a flaky crust.' },
    { id: 'chicken_wings', name: 'Chicken Wings', price: 16.0, image: '/pictures/shrimpKabobs.jpeg', description: 'Crisp fried wings tossed in your choice of sauce.' },
    { id: 'chicken_quarter', name: 'Chicken Quarter Legs', price: 16.0, image: '/pictures/snapperFish.jpeg', description: 'Marinated and grilled chicken quarter legs.' },
    { id: 'snapper', name: 'Snapper Fish', price: 26.0, image: '/pictures/snapperFish.jpeg', description: 'Whole snapper lightly seasoned and fried to perfection.' },
    { id: 'tilapia', name: 'Tilapia (W/Head)', price: 26.0, image: '/pictures/snapperFish.jpeg', description: 'Whole tilapia served with head, seasoned and roasted.' },
    { id: 'salmon', name: 'Salmon', price: 26.0, image: '/pictures/salmon.jpeg', description: 'Pan‑seared salmon fillet with lemon herb butter.' },
    { id: 'chicken_kabobs', name: 'Chicken Kabobs', price: 16.0, image: '/pictures/shrimpKabobs.jpeg', description: 'Skewered chicken with peppers and onions.' },
    { id: 'beef_kabobs', name: 'Beef Kabobs', price: 16.0, image: '/pictures/shrimpKabobs.jpeg', description: 'Tender beef kabobs seasoned and grilled.' },
    { id: 'shrimp_kabobs', name: 'Shrimp Kabobs', price: 16.0, image: '/pictures/shrimpKabobs.jpeg', description: 'Grilled shrimp skewers with garlic butter.' },
    // Sides
    { id: 'jollof_rice', name: 'Jollof Rice', price: 6.5, image: '/pictures/macandcheese.jpeg', description: 'West African seasoned rice cooked in a rich tomato sauce.' },
    { id: 'mac_cheese', name: 'Mac & Cheese', price: 6.5, image: '/pictures/macandcheese.jpeg', description: 'Creamy macaroni baked with cheddar cheese.' },
    { id: 'potato_wedges', name: 'Potato Wedges', price: 6.5, image: '/pictures/potatoWedges.jpeg', description: 'Seasoned potato wedges fried until crispy.' },
    { id: 'cassava_leaf', name: 'Cassava Leaf', price: 16.0, image: '/pictures/macandcheese.jpeg', description: 'Traditional Liberian stew made with cassava leaves.' },
    { id: 'potato_greens', name: 'Potato Greens & White Rice', price: 6.5, image: '/pictures/potatoWedges.jpeg', description: 'Savory potato greens served with fluffy white rice.' },
    // Small add-ons priced at $3.50 each
    { id: 'side_chicken_wing', name: 'Chicken Wing (1 piece)', price: 3.5, image: '/pictures/shrimpKabobs.jpeg', description: 'A single chicken wing as a tasty side.' },
    { id: 'side_chicken_kabob', name: 'Chicken Kabob (1 piece)', price: 3.5, image: '/pictures/shrimpKabobs.jpeg', description: 'One skewer of chicken kabob as a side.' },
    { id: 'side_beef_kabob', name: 'Beef Kabob (1 piece)', price: 3.5, image: '/pictures/shrimpKabobs.jpeg', description: 'One skewer of beef kabob as a side.' },
    { id: 'side_shrimp_kabob', name: 'Shrimp Kabob (1 piece)', price: 3.5, image: '/pictures/shrimpKabobs.jpeg', description: 'One skewer of shrimp kabob as a side.' },
  ];

  // Helper sets for eligibility
  const freeSideEligibleIds = new Set([
    'beef_ribs','chicken_wings','chicken_quarter','snapper','tilapia','salmon','chicken_kabobs','beef_kabobs','shrimp_kabobs'
  ]);
  const sauceEligibleIds = new Set([
    'beef_ribs','beef_burgers','chicken_wings','chicken_quarter','snapper','tilapia','salmon','chicken_kabobs','beef_kabobs','shrimp_kabobs'
  ]);
  const sauceChoices = ['No sauce','Mild sauce','Hot sauce'];

  // In-memory cart: items have id, name, price, qty, sauce?, freeSide?
  const cart = [];

  // State for fulfilment and tips
  let fulfilment = 'pickup';
  let chosenTipType = 'none'; // 'percent', 'custom', or 'none'
  let chosenTipPercent = 0;
  let customTipAmount = 0;

  // Keep track of the last computed totals so they can be reused in payment flows
  let currentTotals = { subtotal: 0, fees: 0, deliveryFee: 0, tip: 0, grand: 0 };

  // Stripe variables
  let stripe, elements, cardElement;
  let paymentRequest = null;
  let paymentRequestButton = null;

  // Helper: format currency
  function fmt(num) {
    return `$${(Math.max(0, +num || 0)).toFixed(2)}`;
  }

  // Save/load cart and user details to/from localStorage
  function saveState() {
    const data = {
      cart,
      fulfilment,
      name: document.getElementById('deliveryName').value,
      phone: document.getElementById('deliveryPhone').value,
      address: document.getElementById('deliveryAddress').value,
      city: document.getElementById('deliveryCity').value,
      zip: document.getElementById('deliveryZip').value,
      freeSide: document.getElementById('freeSideSelect').value,
      chosenTipType,
      chosenTipPercent,
      customTipAmount
    };
    localStorage.setItem('kgkState', JSON.stringify(data));
  }
  function loadState() {
    try {
      const data = JSON.parse(localStorage.getItem('kgkState') || '{}');
      if (Array.isArray(data.cart)) {
        cart.splice(0, cart.length, ...data.cart);
      }
      if (data.fulfilment) fulfilment = data.fulfilment;
      document.getElementById('deliveryName').value = data.name || '';
      document.getElementById('deliveryPhone').value = data.phone || '';
      document.getElementById('deliveryAddress').value = data.address || '';
      document.getElementById('deliveryCity').value = data.city || '';
      document.getElementById('deliveryZip').value = data.zip || '';
      document.getElementById('freeSideSelect').value = data.freeSide || 'Jollof Rice';
      if (data.chosenTipType) chosenTipType = data.chosenTipType;
      if (data.chosenTipPercent) chosenTipPercent = data.chosenTipPercent;
      if (data.customTipAmount) customTipAmount = data.customTipAmount;
    } catch (e) {
      console.warn('Failed to load saved state', e);
    }
  }

  // Render the menu grid
  function renderMenu() {
    const menuEl = document.getElementById('menu');
    menuEl.innerHTML = '';
    for (const item of menuData) {
      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `
        <img src="${item.image}" alt="${item.name}" />
        <div class="card-body">
          <h3>${item.name}</h3>
          <div class="price">${fmt(item.price)}</div>
          ${sauceEligibleIds.has(item.id) ? `<label class="sauce-line"><span>Sauce:</span>
            <select class="sauce-select">
              ${sauceChoices.map(s => `<option>${s}</option>`).join('')}
            </select></label>` : ''}
          <button class="add-btn" data-id="${item.id}">Add to cart</button>
        </div>
      `;
      // Add to cart handler
      card.querySelector('.add-btn').addEventListener('click', e => {
        const sauceSel = card.querySelector('.sauce-select');
        const sauce = sauceSel ? sauceSel.value : null;
        addItemToCart(item, sauce);
      });
      menuEl.appendChild(card);
    }
  }

  function addItemToCart(item, sauce) {
    // Determine free side if eligible
    const freeSide = freeSideEligibleIds.has(item.id) ? document.getElementById('freeSideSelect').value : null;
    // Check if an identical item (same id, sauce, freeSide) exists
    const existing = cart.find(i => i.id === item.id && i.sauce === sauce && i.freeSide === freeSide);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ id: item.id, name: item.name, price: item.price, qty: 1, sauce, freeSide });
    }
    renderCart();
    saveState();
  }

  function removeItemFromCart(itemId, sauce, freeSide) {
    const idx = cart.findIndex(i => i.id === itemId && i.sauce === sauce && i.freeSide === freeSide);
    if (idx >= 0) {
      cart[idx].qty -= 1;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);
      renderCart();
      saveState();
    }
  }

  // Render cart drawer contents
  function renderCart() {
    const listEl = document.getElementById('cartItems');
    listEl.innerHTML = '';
    if (cart.length === 0) {
      listEl.innerHTML = '<p class="muted">Your cart is empty.</p>';
    } else {
      for (const item of cart) {
        const row = document.createElement('div');
        row.className = 'row-item';
        row.innerHTML = `
          <div class="name">${item.name}${item.sauce ? ` <span class="muted">(${item.sauce})</span>` : ''}${item.freeSide ? ` <span class="muted">[${item.freeSide}]</span>` : ''}</div>
          <div class="qty-controls">
            <button class="dec" aria-label="Decrease quantity">−</button>
            <span>${item.qty}</span>
            <button class="inc" aria-label="Increase quantity">+</button>
          </div>
          <div class="line">${fmt(item.qty * item.price)}</div>
        `;
        row.querySelector('.dec').addEventListener('click', () => removeItemFromCart(item.id, item.sauce, item.freeSide));
        row.querySelector('.inc').addEventListener('click', () => addItemToCart(item, item.sauce));
        listEl.appendChild(row);
      }
    }
    // Update header cart count
    document.getElementById('viewCartBtn').textContent = `Cart (${cart.reduce((n, i) => n + i.qty, 0)})`;
    // Show or hide free side block based on eligibility
    const eligible = cart.some(i => freeSideEligibleIds.has(i.id));
    document.getElementById('freeSideBlock').classList.toggle('hidden', !eligible);
    // Recompute totals and refresh tip labels
    computeAndDisplayTotals();
  }

  // Compute fees, tip and total, update display, and return totals object
  function computeAndDisplayTotals() {
    // Subtotal
    let subtotal = 0;
    cart.forEach(item => {
      subtotal += (item.price || 0) * (item.qty || 0);
    });
    // Service & tax: 10% of subtotal
    const fees = +(subtotal * 0.1).toFixed(2);
    // Delivery fee: constant if delivery selected and there is a subtotal
    const deliveryFee = (fulfilment === 'delivery' && subtotal > 0) ? 3.99 : 0;
    // Tip base: subtotal + fees + delivery
    const tipBase = subtotal + fees + deliveryFee;
    let tipAmount = 0;
    if (fulfilment === 'delivery' && tipBase > 0) {
      if (chosenTipType === 'percent') {
        tipAmount = +(tipBase * chosenTipPercent).toFixed(2);
      } else if (chosenTipType === 'custom') {
        tipAmount = +(customTipAmount || 0);
      }
    }
    const grand = subtotal + fees + deliveryFee + tipAmount;
    // Update DOM values
    document.getElementById('subtotal').textContent = fmt(subtotal);
    document.getElementById('feesTax').textContent = fmt(fees);
    if (deliveryFee > 0) {
      document.getElementById('deliveryFeeRow').hidden = false;
      document.getElementById('deliveryFee').textContent = fmt(deliveryFee);
    } else {
      document.getElementById('deliveryFeeRow').hidden = true;
      document.getElementById('deliveryFee').textContent = fmt(0);
    }
    document.getElementById('tipTotal').textContent = fmt(tipAmount);
    document.getElementById('grandTotal').textContent = fmt(grand);
    document.getElementById('tipAmount').textContent = fmt(tipAmount);
    // Refresh tip button labels with current base
    updateTipButtonLabels(tipBase);
    // Store current totals globally for payment calculations
    currentTotals = { subtotal, fees, deliveryFee, tip: tipAmount, grand };
    // Update PaymentRequest total if available
    try {
      if (paymentRequest) {
        const newTotal = Math.round(grand * 100);
        paymentRequest.update({
          total: { label: 'KG Grill Kitchen', amount: newTotal },
          // Optional: show subtotal and fees as display items
          displayItems: [
            { label: 'Subtotal', amount: Math.round(subtotal * 100) },
            { label: 'Fees & Tax', amount: Math.round(fees * 100) },
            deliveryFee > 0 ? { label: 'Delivery fee', amount: Math.round(deliveryFee * 100) } : null,
            tipAmount > 0 ? { label: 'Tip', amount: Math.round(tipAmount * 100) } : null
          ].filter(Boolean)
        });
      }
    } catch (e) {
      // Ignore update errors; will fallback to original total
    }
    return currentTotals;
  }

  // Update tip button labels with computed amounts
  function updateTipButtonLabels(base) {
    document.querySelectorAll('.tip-btn').forEach(btn => {
      const val = btn.dataset.tip;
      if (val === 'custom') {
        return;
      }
      const pct = parseFloat(val);
      const amount = +(base * pct).toFixed(2);
      const percentLabel = Math.round(pct * 100);
      btn.textContent = `${percentLabel}% (${fmt(amount)})`;
      if (chosenTipType === 'percent' && chosenTipPercent === pct) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
    // Update custom button selected state
    const customBtn = document.querySelector('.tip-btn[data-tip="custom"]');
    if (chosenTipType === 'custom') customBtn.classList.add('selected'); else customBtn.classList.remove('selected');
  }

  // Tip buttons and custom input event handlers
  function initTipControls() {
    document.querySelectorAll('.tip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.tip;
        if (val === 'custom') {
          chosenTipType = 'custom';
          customTipAmount = parseFloat(document.getElementById('customTip').value) || 0;
          document.getElementById('customTipRow').classList.remove('hidden');
        } else {
          chosenTipType = 'percent';
          chosenTipPercent = parseFloat(val);
          document.getElementById('customTipRow').classList.add('hidden');
        }
        computeAndDisplayTotals();
        saveState();
      });
    });
    document.getElementById('customTip').addEventListener('input', () => {
      customTipAmount = parseFloat(document.getElementById('customTip').value) || 0;
      chosenTipType = 'custom';
      computeAndDisplayTotals();
      saveState();
    });
  }

  // Fulfilment change handler
  function initFulfilmentControls() {
    document.querySelectorAll('input[name="orderType"]').forEach(radio => {
      radio.addEventListener('change', () => {
        fulfilment = radio.value;
        // Show/hide delivery fields
        document.getElementById('deliveryFields').classList.toggle('hidden', fulfilment !== 'delivery');
        // If switching to delivery, request location and show map
        if (fulfilment === 'delivery') {
          ensureMapAndLocation();
        }
        computeAndDisplayTotals();
        saveState();
      });
    });
  }

  // Cart drawer controls
  function initCartControls() {
    document.getElementById('viewCartBtn').addEventListener('click', () => {
      cartDrawer.classList.add('open');
    });
    document.getElementById('closeCart').addEventListener('click', () => {
      cartDrawer.classList.remove('open');
    });
    document.getElementById('continueShopping').addEventListener('click', () => {
      cartDrawer.classList.remove('open');
    });
  }

  // Geolocation & map with Leaflet
  let mapInstance = null;
  let markersLayer = null;
  function ensureMapAndLocation() {
    if (mapInstance) return;
    const mapEl = document.getElementById('deliveryMap');
    mapInstance = L.map(mapEl, { zoomControl: true }).setView([39.9526, -75.1652], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(mapInstance);
    markersLayer = L.layerGroup().addTo(mapInstance);
    // Try geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(position => {
        const { latitude, longitude } = position.coords;
        markersLayer.clearLayers();
        const userMarker = L.marker([latitude, longitude]).addTo(markersLayer).bindPopup('Your location');
        const storeMarker = L.marker([39.9526, -75.1652]).addTo(markersLayer).bindPopup('KG Grill Kitchen');
        const bounds = L.latLngBounds([latitude, longitude], [39.9526, -75.1652]);
        mapInstance.fitBounds(bounds.pad(0.25));
        document.getElementById('deliveryEta').textContent = 'Estimated delivery time: 25–35 mins.';
        document.getElementById('deliveryMapWrap').classList.remove('hidden');
      }, err => {
        console.warn('Geolocation failed', err);
        document.getElementById('deliveryEta').textContent = '';
      });
    }
  }

  // Stripe initialization
  async function initStripe() {
    // Determine publishable key: meta/global first, else request from backend
    let key = stripePk;
    if (!key) {
      try {
        const res = await fetch(api('/config'));
        if (res.ok) {
          const data = await res.json();
          // Accept multiple possible field names for compatibility
          key = data.publishableKey || data.stripePublishableKey || data.stripePk || data.publishable_key || data.stripe_pk || '';
        }
      } catch (err) {
        console.warn('Failed to fetch Stripe config', err);
      }
    }
    if (!key) {
      console.error('No Stripe publishable key provided. Payment will be disabled.');
      return;
    }
    stripe = Stripe(key);
    elements = stripe.elements();
    cardElement = elements.create('card');
    cardElement.mount('#cardElement');
    // Setup PaymentRequest for Apple Pay / Google Pay if available
    try {
      // Compute current grand total for PaymentRequest
      const totalsNow = computeAndDisplayTotals();
      const totalCents = Math.round((totalsNow.grand || 0) * 100);
      paymentRequest = stripe.paymentRequest({
        country: 'US',
        currency: 'usd',
        total: { label: 'KG Grill Kitchen', amount: totalCents },
        requestPayerName: true,
        requestPayerPhone: true
      });
      const result = await paymentRequest.canMakePayment();
      if (result) {
        paymentRequestButton = elements.create('paymentRequestButton', { paymentRequest });
        paymentRequestButton.mount('#applePayWrap');
        document.getElementById('applePayWrap').classList.remove('hidden');
        // Handle payment via wallet
        paymentRequest.on('paymentmethod', async ev => {
          const clientSecret = await createPaymentIntent();
          if (!clientSecret) {
            ev.complete('fail');
            return;
          }
          const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
            payment_method: ev.paymentMethod.id,
            shipping: fulfilment === 'delivery' ? {
              name: document.getElementById('deliveryName').value,
              phone: document.getElementById('deliveryPhone').value,
              address: { line1: document.getElementById('deliveryAddress').value || '', country: 'US' }
            } : undefined
          }, { handleActions: false });
          if (error) {
            ev.complete('fail');
            checkoutStatus.textContent = error.message || 'Payment failed';
          } else {
            ev.complete('success');
            await handlePaymentSuccess(paymentIntent.id);
          }
        });
      }
    } catch (err) {
      console.warn('PaymentRequest setup failed', err);
    }
  }

  // Create PaymentIntent on backend
  async function createPaymentIntent() {
    // Build order payload
    // Ensure totals are up-to-date
    const totals = computeAndDisplayTotals();
    const payload = {
      items: cart.map(i => ({ id: i.id, qty: i.qty, price: i.price, sauce: i.sauce || null, freeSide: i.freeSide || null })),
      fulfilment,
      name: document.getElementById('deliveryName').value || '',
      phone: document.getElementById('deliveryPhone').value || '',
      address: document.getElementById('deliveryAddress').value || '',
      city: document.getElementById('deliveryCity').value || '',
      zip: document.getElementById('deliveryZip').value || '',
      totalCents: Math.round(totals.grand * 100),
      tipCents: Math.round(totals.tip * 100)
    };
    try {
      const res = await fetch(api('/create-payment-intent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to create payment intent');
      }
      const { clientSecret } = await res.json();
      return clientSecret;
    } catch (err) {
      console.error(err);
      checkoutStatus.textContent = err.message || 'Payment intent error';
      return null;
    }
  }

  // Compute totals for payload (not updating DOM)
  function computeTotalsForPayload() {
    // Use the most recent computed totals (ensures consistency with displayed values)
    return { ...currentTotals };
  }

  // Handle payment success: send Telegram notify, clear cart, show message
  async function handlePaymentSuccess(paymentIntentId) {
    checkoutStatus.textContent = 'Payment complete! Thank you.';
    // Notify backend of successful payment (non-blocking)
    try {
      await fetch(api('/telegram-notify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'paid', paymentIntentId, total: document.getElementById('grandTotal').textContent })
      });
    } catch {}
    // Clear cart and persist
    cart.splice(0, cart.length);
    renderCart();
    saveState();
  }

  // Payment button click handler
  function initPaymentButton() {
    document.getElementById('payBtn').addEventListener('click', async () => {
      if (!stripe) {
        checkoutStatus.textContent = 'Payments unavailable.';
        return;
      }
      // Pre-check: require name and phone for delivery
      if (fulfilment === 'delivery') {
        if (!document.getElementById('deliveryName').value || !document.getElementById('deliveryPhone').value) {
          checkoutStatus.textContent = 'Please enter name and phone for delivery.';
          return;
        }
      }
      checkoutStatus.textContent = 'Processing…';
      const clientSecret = await createPaymentIntent();
      if (!clientSecret) return;
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: cardElement, billing_details: { name: document.getElementById('deliveryName').value || 'KG Customer' } },
        shipping: fulfilment === 'delivery' ? {
          name: document.getElementById('deliveryName').value || 'KG Customer',
          phone: document.getElementById('deliveryPhone').value || '',
          address: { line1: document.getElementById('deliveryAddress').value || '', country: 'US' }
        } : undefined
      });
      if (error) {
        checkoutStatus.textContent = error.message || 'Payment failed.';
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        await handlePaymentSuccess(paymentIntent.id);
      }
    });
  }

  // Initialize analytics (send a page view)
  function initAnalytics() {
    if (window.KGAnalytics && typeof window.KGAnalytics.track === 'function') {
      window.KGAnalytics.track('page_view');
    }
  }

  // Document ready
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    renderMenu();
    renderCart();
    initFulfilmentControls();
    initTipControls();
    initCartControls();
    initPaymentButton();
    initStripe();
    initAnalytics();
  });
})();