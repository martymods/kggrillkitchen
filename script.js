/*
 * KG Grill Kitchen – front-end logic
 * - Menu + cart
 * - Geolocation + Leaflet map
 * - Delivery fee/ETA calc
 * - Persist user fields (localStorage)
 * - Stripe (card + Apple/Google Pay)
 * - API base autodetect (Delco Tech backend)
 */

// ---- CONFIG HELPERS --------------------------------------------------------
function getMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el ? el.content.trim() : '';
}
const API_BASE = getMeta('kg-api-base') || ''; // e.g., https://delcotechdivision.com/kg-api
const STRIPE_PK_FROM_META = getMeta('kg-stripe-pk');
function api(url) { return (API_BASE || '') + url; }

// ---- MENU ------------------------------------------------------------------
const mains = [
  { id:'beef_ribs',        name:'Beef Ribs',               price:18.99, image:'https://source.unsplash.com/featured/?beef-ribs,bbq', description:'Slow-cooked ribs glazed with our signature BBQ sauce.' },
  { id:'beef_burgers',     name:'Beef Burgers',            price:10.99, image:'https://source.unsplash.com/featured/?burger,grill', description:'Juicy grilled burgers with fresh lettuce and tomato.' },
  { id:'beef_patties',     name:'Beef Patties',            price: 3.50, image:'https://source.unsplash.com/featured/?beef-patties,empanada', description:'Crispy golden beef patties with a flaky crust.' },
  { id:'chicken_wings',    name:'Chicken Wings',           price: 9.99, image:'https://source.unsplash.com/featured/?chicken-wings', description:'Crisp fried wings tossed in your choice of sauce.' },
  { id:'chicken_quarter',  name:'Chicken Quarter Legs',    price: 7.99, image:'https://source.unsplash.com/featured/?grilled-chicken', description:'Marinated and grilled chicken quarter legs.' },
  { id:'snapper',          name:'Snapper Fish',            price:15.50, image:'https://source.unsplash.com/featured/?snapper-fish', description:'Whole snapper lightly seasoned and fried to perfection.' },
  { id:'tilapia',          name:'Tilapia (w/ Head)',       price:12.00, image:'https://source.unsplash.com/featured/?tilapia', description:'Whole tilapia served with head, seasoned and roasted.' },
  { id:'salmon',           name:'Salmon',                  price:16.99, image:'https://source.unsplash.com/featured/?salmon', description:'Pan-seared salmon fillet with lemon herb butter.' },
  { id:'chicken_kabobs',   name:'Chicken Kabobs',          price:11.99, image:'https://source.unsplash.com/featured/?chicken-kebab', description:'Skewered chicken with peppers and onions.' },
  { id:'beef_kabobs',      name:'Beef Kabobs',             price:12.99, image:'https://source.unsplash.com/featured/?beef-kebab', description:'Tender beef kabobs seasoned and grilled.' },
  { id:'shrimp_kabobs',    name:'Shrimp Kabobs',           price:13.99, image:'https://source.unsplash.com/featured/?shrimp-kebab', description:'Grilled shrimp skewers with garlic butter.' },
];
const sides = [
  { id:'jollof_rice',    name:'Jollof Rice',                  price: 4.50, image:'https://source.unsplash.com/featured/?jollof-rice', description:'West African seasoned rice cooked in a rich tomato sauce.' },
  { id:'mac_cheese',     name:'Mac & Cheese',                 price: 4.99, image:'https://source.unsplash.com/featured/?mac-and-cheese', description:'Creamy macaroni baked with cheddar cheese.' },
  { id:'potato_wedges',  name:'Potato Wedges',                price: 3.99, image:'https://source.unsplash.com/featured/?potato-wedges', description:'Seasoned potato wedges fried until crispy.' },
  { id:'cassava_leaf',   name:'Cassava Leaf',                 price: 5.50, image:'https://source.unsplash.com/featured/?cassava-leaves', description:'Traditional Liberian stew made with cassava leaves.' },
  { id:'potato_greens',  name:'Potato Greens & White Rice',   price: 5.99, image:'https://source.unsplash.com/featured/?potato-greens', description:'Savory potato greens served with fluffy white rice.' },
];

// ---- CART / TOTALS ---------------------------------------------------------
const cart = [];
const restaurantCoords = { lat: 39.9526, lon: -75.1652 }; // Philly center-ish
let userCoords = null;
let deliveryFee = 0;

let stripe = null;
let elements = null;
let cardElement = null;
let paymentRequest = null;
let currentClientSecret = null;

function formatCurrency(n){ return '$' + (Math.round(n*100)/100).toFixed(2); }

function computeDistanceMiles(lat1, lon1, lat2, lon2) {
  const R=6371, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return (R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))) * 0.621371;
}
function computeDeliveryFee(distanceMiles){ return 3.0 + (1.0 * distanceMiles); }

function renderMenu(){
  const put = (arr, containerId) => {
    const el=document.getElementById(containerId); el.innerHTML='';
    arr.forEach(item=>{
      const card=document.createElement('div'); card.className='menu-item';
      card.innerHTML=`
        <img src="${item.image}" alt="${item.name}">
        <div class="menu-content">
          <h3>${item.name}</h3>
          <p>${item.description}</p>
          <div class="price">${formatCurrency(item.price)}</div>
          <button data-id="${item.id}">Add to Cart</button>
        </div>`;
      card.querySelector('button').onclick=()=>addToCart(item);
      el.appendChild(card);
    });
  };
  put(mains,'mains-container');
  put(sides,'sides-container');
}

function addToCart(item){
  const existing = cart.find(ci=>ci.id===item.id);
  if (existing) existing.quantity += 1;
  else cart.push({ ...item, quantity:1 });
  openCart(); renderCart(); updateCartButton();
}

function renderCart(){
  const wrap=document.getElementById('cartItems'); wrap.innerHTML='';
  cart.forEach(item=>{
    const row=document.createElement('div'); row.className='cart-item';
    row.innerHTML=`
      <img src="${item.image}" alt="${item.name}">
      <div class="cart-item-details">
        <h4>${item.name}</h4>
        <div class="quantity">
          <button data-action="decrease">−</button>
          <span>${item.quantity}</span>
          <button data-action="increase">+</button>
        </div>
        <div class="price">${formatCurrency(item.price*item.quantity)}</div>
      </div>`;
    const [dec,inc] = row.querySelectorAll('button');
    dec.onclick=()=>updateQuantity(item.id,-1);
    inc.onclick=()=>updateQuantity(item.id, 1);
    wrap.appendChild(row);
  });
  updateCartTotals();
}
function updateQuantity(id, d){
  const i=cart.findIndex(ci=>ci.id===id); if(i<0) return;
  cart[i].quantity += d;
  if (cart[i].quantity<=0) cart.splice(i,1);
  renderCart(); updateCartButton();
}

function updateCartTotals(){
  const subtotal = cart.reduce((s,i)=>s+i.price*i.quantity,0);
  let total = subtotal;

  const orderType = document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';

  const deliveryRow = document.getElementById('deliveryRow');
  const deliveryFeeEl = document.getElementById('cartDeliveryFee');
  if (orderType==='delivery' && deliveryFee>0){
    deliveryRow.hidden=false;
    deliveryFeeEl.textContent=formatCurrency(deliveryFee);
    total += deliveryFee;
  } else deliveryRow.hidden=true;

  const fees = subtotal*0.10; // Example service+tax combined
  const feesRow=document.getElementById('feesRow');
  const cartFees=document.getElementById('cartFees');
  if (subtotal>0){ feesRow.hidden=false; cartFees.textContent=formatCurrency(fees); total+=fees; }
  else feesRow.hidden=true;

  document.getElementById('cartSubtotal').textContent=formatCurrency(subtotal);
  document.getElementById('cartTotal').textContent=formatCurrency(total);
}
function openCart(){ const p=document.getElementById('cartPanel'); p.classList.add('open'); p.setAttribute('aria-hidden','false'); }
function closeCart(){ const p=document.getElementById('cartPanel'); p.classList.remove('open'); p.setAttribute('aria-hidden','true'); }
function updateCartButton(){
  const totalItems=cart.reduce((s,i)=>s+i.quantity,0);
  document.getElementById('viewCartBtn').textContent=`Cart (${totalItems})`;
}

// ---- PERSIST FIELDS --------------------------------------------------------
function saveField(k,v){ if(v) localStorage.setItem(k,v); }
function loadSavedDetails(){
  const s = (k)=>localStorage.getItem(k) || '';
  const nameSaved=s('kg_name'), phoneSaved=s('kg_phone'), addrSaved=s('kg_address'), otSaved=s('kg_orderType');
  if (nameSaved)  document.getElementById('customerName').value = nameSaved;
  if (phoneSaved) document.getElementById('customerPhone').value = phoneSaved;
  if (addrSaved)  document.getElementById('deliveryAddress').value = addrSaved;
  if (otSaved) {
    const r=document.querySelector(`input[name="orderType"][value="${otSaved}"]`);
    if (r) r.checked=true;
  }
}

// ---- GEO + MAP -------------------------------------------------------------
async function getLocationAndPrefill(){
  if(!navigator.geolocation) { console.warn('No geolocation support'); return; }
  navigator.geolocation.getCurrentPosition(async pos=>{
    const { latitude:lat, longitude:lon } = pos.coords;
    userCoords = { lat, lon };
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);
      const j = await r.json();
      const label = j.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      document.getElementById('deliveryAddress').value = label;
      saveField('kg_address', label);
    } catch (e){ console.warn('Reverse geocode failed', e); }
    showMapAndDistance();
  }, err => console.warn('Geolocation error:', err));
}

function showMapAndDistance(){
  if (!userCoords) return;
  const mapContainer=document.getElementById('mapContainer');
  mapContainer.hidden=false;

  if (window.kgMap) window.kgMap.remove();
  const map=L.map('mapContainer').setView([userCoords.lat,userCoords.lon],13);
  window.kgMap=map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);

  L.marker([restaurantCoords.lat,restaurantCoords.lon]).addTo(map).bindPopup('KG Grill Kitchen').openPopup();
  L.marker([userCoords.lat,userCoords.lon]).addTo(map).bindPopup('Your location').openPopup();

  const lineColor=getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#2e8b57';
  const poly=L.polyline([[restaurantCoords.lat,restaurantCoords.lon],[userCoords.lat,userCoords.lon]],{color:lineColor}).addTo(map);
  map.fitBounds(poly.getBounds(),{padding:[20,20]});

  const dist=computeDistanceMiles(restaurantCoords.lat,restaurantCoords.lon,userCoords.lat,userCoords.lon);
  deliveryFee = computeDeliveryFee(dist);
  const eta = Math.round(dist*2 + 10);
  document.getElementById('distanceSummary').textContent = `Distance: ${dist.toFixed(2)} miles. Delivery fee: ${formatCurrency(deliveryFee)}. Estimated delivery time: ${eta}–${eta+10} mins.`;

  updateCartTotals();
}

function updateOrderType(){
  const orderType=document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const f=document.getElementById('deliveryFields');
  if (orderType==='delivery'){
    f.hidden=false;
    document.getElementById('deliveryAddress').required=true;
    getLocationAndPrefill();
  } else {
    f.hidden=true;
    document.getElementById('deliveryAddress').required=false;
    document.getElementById('mapContainer').hidden=true;
    document.getElementById('distanceSummary').textContent='';
    deliveryFee=0;
    updateCartTotals();
  }
  saveField('kg_orderType', orderType);
}

// ---- STRIPE ---------------------------------------------------------------
async function initStripe(){
  // 1) Try backend /config if API_BASE provided, else current origin
  let publishableKey = '';
  try {
    const resp = await fetch(api('/config'));
    if (resp.ok) {
      const data = await resp.json().catch(()=>({}));
      publishableKey = data.stripePublishableKey || data.stripePk || '';
    }
  } catch (_) {}

  // 2) Fall back to meta tag value (or global window.KG_STRIPE_PK)
  if (!publishableKey) publishableKey = STRIPE_PK_FROM_META || (window.KG_STRIPE_PK || '');

  if (!publishableKey) {
    console.error('No Stripe publishable key provided. Payment will be disabled.');
    return;
  }

  stripe = Stripe(publishableKey);
  elements = stripe.elements();
  cardElement = elements.create('card');
  cardElement.mount('#card-element');

  // Apple/Google Pay (PaymentRequest)
  const pr = stripe.paymentRequest({
    country:'US', currency:'usd',
    total:{ label:'KG Grill Kitchen', amount:0 },
    requestPayerName:true, requestPayerEmail:true, requestPayerPhone:true, requestShipping:true
  });
  pr.on('paymentmethod', async ev=>{
    try{
      const clientSecret = await createPaymentIntent();
      if (!clientSecret) throw new Error('Could not create PaymentIntent');

      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: ev.paymentMethod.id,
        shipping: {
          name: document.getElementById('customerName').value,
          phone: document.getElementById('customerPhone').value,
          address: { line1: document.getElementById('deliveryAddress').value || '', country:'US' }
        }
      }, { handleActions:false });

      if (error) { ev.complete('fail'); displayPaymentMessage(error.message || 'Payment failed'); }
      else { ev.complete('success'); handleOrderSuccess(paymentIntent.id); }
    } catch(e){ ev.complete('fail'); displayPaymentMessage(e.message || 'Payment error'); }
  });

  const prEl = elements.create('paymentRequestButton', { paymentRequest: pr });
  const can = await pr.canMakePayment();
  if (can) {
    document.getElementById('payment-request-button').hidden = false;
    prEl.mount('#payment-request-button');
  }
}

async function createPaymentIntent(){
  if (currentClientSecret) return currentClientSecret;

  const orderType=document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const name=document.getElementById('customerName').value;
  const phone=document.getElementById('customerPhone').value;
  const address=document.getElementById('deliveryAddress').value;

  const items = cart.map(i=>({ id:i.id, name:i.name, unitPrice:Math.round(i.price*100), quantity:i.quantity }));

  const payload = {
    items, currency:'usd', orderType, name, phone, address,
    deliveryCents: Math.round(deliveryFee*100)
  };

  try{
    const resp = await fetch(api('/create-payment-intent'), {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    if(!resp.ok){
      const err = await resp.json().catch(()=>({}));
      throw new Error(err.message || 'Failed to create payment intent');
    }
    const data = await resp.json();
    currentClientSecret = data.clientSecret;
    return currentClientSecret;
  } catch(e){
    displayPaymentMessage(e.message || 'Unable to create payment intent');
    return null;
  }
}

function displayPaymentMessage(msg){
  const el=document.getElementById('payment-message');
  el.textContent=msg; el.hidden=false;
}
function clearPaymentMessage(){
  const el=document.getElementById('payment-message');
  el.textContent=''; el.hidden=true;
}

async function handleOrderSuccess(paymentIntentId){
  const orderType=document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
  const name=document.getElementById('customerName').value;
  const phone=document.getElementById('customerPhone').value;
  const address=document.getElementById('deliveryAddress').value;

  const order = {
    orderType, name, phone, address,
    items: cart.map(i=>({ id:i.id, name:i.name, quantity:i.quantity, unitPrice:i.price })),
    deliveryFee, paymentIntentId
  };

  // Non-blocking: Telegram notify via backend
  try { fetch(api('/telegram-notify'), { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(order) }); } catch(_){}

  alert(`Thank you, ${name}! Your order has been placed successfully.`);

  cart.length=0; renderCart(); updateCartButton(); closeCart();
  document.getElementById('checkoutOverlay').classList.remove('show');
  document.getElementById('checkoutOverlay').setAttribute('aria-hidden','true');
  currentClientSecret=null; clearPaymentMessage();
}

// ---- UI EVENTS -------------------------------------------------------------
function initEventListeners(){
  document.getElementById('viewCartBtn').onclick=()=>{ cart.length?openCart():alert('Your cart is empty.'); };
  document.getElementById('closeCart').onclick=closeCart;

  document.querySelectorAll('input[name="orderType"]').forEach(r=>r.addEventListener('change', updateOrderType));

  document.getElementById('checkoutButton').onclick=()=>{
    if(!cart.length) return alert('Please add items to your cart first.');
    document.getElementById('checkoutOverlay').classList.add('show');
    document.getElementById('checkoutOverlay').setAttribute('aria-hidden','false');
  };

  document.getElementById('checkoutOverlay').addEventListener('click',(e)=>{
    if (e.target.id==='checkoutOverlay'){
      document.getElementById('checkoutOverlay').classList.remove('show');
      document.getElementById('checkoutOverlay').setAttribute('aria-hidden','true');
    }
  });

  // Persist fields
  document.getElementById('customerName').addEventListener('input', e=>saveField('kg_name', e.target.value));
  document.getElementById('customerPhone').addEventListener('input', e=>saveField('kg_phone', e.target.value));
  document.getElementById('deliveryAddress').addEventListener('input', e=>saveField('kg_address', e.target.value));

  // Stripe card flow submit
  document.getElementById('checkoutForm').addEventListener('submit', async (e)=>{
    e.preventDefault(); clearPaymentMessage();

    const name=document.getElementById('customerName').value.trim();
    const phone=document.getElementById('customerPhone').value.trim();
    const orderType=document.querySelector('input[name="orderType"]:checked')?.value || 'pickup';
    const addr=(document.getElementById('deliveryAddress').value||'').trim();
    if(!name || !phone || (orderType==='delivery' && !addr)){
      displayPaymentMessage('Please fill out all required fields.');
      return;
    }

    const clientSecret = await createPaymentIntent();
    if (!clientSecret) return;

    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: { name, phone }
      },
      shipping: orderType==='delivery' ? { name, phone, address:{ line1: addr, country:'US' } } : undefined
    });

    if (error) displayPaymentMessage(error.message || 'Payment failed');
    else if (paymentIntent?.status === 'succeeded') handleOrderSuccess(paymentIntent.id);
  });
}

// ---- BOOT ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async ()=>{
  renderMenu();
  loadSavedDetails();
  updateOrderType();
  renderCart();
  updateCartButton();
  initEventListeners();
  await initStripe(); // important
});
