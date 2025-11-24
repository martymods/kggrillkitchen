(function() {
  const PRICE_OVERRIDE_STORAGE_KEY = 'kgPriceOverrides';

  // Menu definitions shared between customer and line views
  const mains = [
    {
      id: 'beef_ribs',
      name: 'Beef Ribs',
      price: 16.0, // was 20.0
      description: 'Slow-cooked ribs glazed with our signature BBQ sauce.',
      image: '/pictures/DSC04857.JPG',
    },
    {
      id: 'beef_burgers',
      name: 'Lamb Burger',
      price: 5.5,
      description: 'Juicy grilled burgers with fresh lettuce and tomato.',
      image: '/pictures/lamb_burger.png',
    },
    {
      id: 'beef_patties',
      name: 'Beef Patties',
      price: 3.5,
      description: 'Crispy golden beef patties with a flaky crust.',
      image: '/pictures/kg_Grill_Kitchen_LogoDesign.png', // <= holder logo
    },
    {
      id: 'chicken_wings',
      name: 'Chicken Wings',
      price: 11.0,
      description: 'Crisp fried wings tossed in your choice of sauce.',
      image: '/pictures/chickenwing.gif', // <= UPDATED
    },
    {
      id: 'chicken_quarter',
      name: 'Chicken Quarter Legs',
      price: 18.0, // was 7.5
      description: 'Marinated and grilled chicken quarter legs.',
      image: '/pictures/kg_Grill_Kitchen_LogoDesign.png', // holder logo
    },
    {
      id: 'snapper',
      name: 'Snapper Fish',
      price: 26.0,
      description: 'Whole snapper lightly seasoned and fried to perfection.',
      image: '/pictures/snapper.gif',
    },
    {
      id: 'tilapia',
      name: 'Tilapia (w/ Head)',
      price: 21.0,
      description: 'Whole tilapia served with head, seasoned and roasted.',
      image: '/pictures/kg_Grill_Kitchen_LogoDesign.png', // <= holder logo
    },
    {
      id: 'salmon',
      name: 'Salmon',
      price: 21.0,
      description: 'Pan‑seared salmon fillet with lemon herb butter.',
      image: '/pictures/salmon.jpeg',
    },
    {
      id: 'chicken_kabobs',
      name: 'Chicken Kabobs',
      price: 11.0,
      description: 'Skewered chicken with peppers and onions.',
      image: '/pictures/chickenKabobs.JPG', // <= UPDATED,
    },
    {
      id: 'beef_kabobs',
      name: 'Beef Kabobs',
      price: 11.0,
      description: 'Tender beef kabobs seasoned and grilled.',
      image: '/pictures/beefKabobs.JPG', // <= UPDATED
    },
    {
      id: 'shrimp_kabobs',
      name: 'Shrimp Kabobs',
      price: 11.0,
      description: 'Grilled shrimp skewers with garlic butter.',
      image: '/pictures/shrimpKabobs.jpeg',
    },
    {
      id: 'kg_mystery',
      name: 'KG Surprise Item',
      price: 4.0,
      description: 'A random treat from KG’s grill – could be a wing, kabob, extra scoop or something special.',
      image: '/pictures/kg_mystery-item.png',
    },
  ];

  const sides = [
    {
      id: 'jollof_rice',
      name: 'Jollof Rice',
      price: 6.0,
      description: 'West African seasoned rice cooked in a rich tomato sauce.',
      image: '/pictures/jollofRice.gif',
    },
    {
      id: 'mac_cheese',
      name: 'Mac & Cheese',
      price: 6.0,
      description: 'Creamy macaroni baked with cheddar cheese.',
      image: '/pictures/macandcheese.png',
    },
    {
      id: 'potato_wedges',
      name: 'Potato Wedges',
      price: 6.0,
      description: 'Seasoned potato wedges fried until crispy.',
      image: '/pictures/potatoWedges.jpeg',
    },
    {
      id: 'cassava_leaf',
      name: 'Cassava Leaf',
      price: 21.50,
      description: 'Traditional Liberian stew made with cassava leaves.',
      image: '/pictures/kg_Grill_Kitchen_LogoDesign.png', // <= holder logo
    },
    {
      id: 'potato_greens',
      name: 'Potato Greens & White Rice',
      price: 21.50,
      description: 'Savory potato greens served with fluffy white rice.',
      image: '/pictures/kg_Grill_Kitchen_LogoDesign.png', // <= holder logo
    },
    {
      id: 'side_chicken_wing',
      name: 'Chicken Wing (1 piece)',
      price: 3.5,
      description: 'A single chicken wing as a tasty side.',
      image: '/pictures/chickenwing.gif', // <= UPDATED
    },
    {
      id: 'side_chicken_kabob',
      name: 'Chicken Kabob (1 piece)',
      price: 3.5,
      description: 'One skewer of chicken kabob as a side.',
      image: '/pictures/beefKabobs.JPG', // <= UPDATED
    },
    {
      id: 'side_beef_kabob',
      name: 'Beef Kabob (1 piece)',
      price: 3.5,
      description: 'One skewer of beef kabob as a side.',
      image: '/pictures/beefKabobs.JPG', // <= UPDATED
    },
    {
      id: 'side_shrimp_kabob',
      name: 'Shrimp Kabob (1 piece)',
      price: 3.5,
      description: 'One skewer of shrimp kabob as a side.',
      image: '/pictures/shrimpKabobs.jpeg',
    },
  ];

  const portionOptions = {
    beef_ribs: [
      { key: '1_rib', label: '1 rib', onlinePrice: 16, inlinePrice: 15 },
      { key: '2_ribs', label: '2 ribs', onlinePrice: 21, inlinePrice: 20 },
      { key: '3_ribs', label: '3 ribs', onlinePrice: 26, inlinePrice: 25 },
    ],
    chicken_wings: [
      { key: '2_wings', label: '2 wings', onlinePrice: 11, inlinePrice: 10 },
      { key: '3_wings', label: '3 wings', onlinePrice: 15, inlinePrice: 13 },
      { key: '4_wings', label: '4 wings', onlinePrice: 18, inlinePrice: 15 },
    ],
    chicken_quarter: [
      { key: '1_leg', label: '1 leg', onlinePrice: 15, inlinePrice: 12 },
      { key: '2_legs', label: '2 legs', onlinePrice: 23, inlinePrice: 19 },
      { key: '3_legs', label: '3 legs', onlinePrice: 30, inlinePrice: 26 },
    ],
    chicken_kabobs: [
      { key: '2_kabobs', label: '2 kabobs', onlinePrice: 12, inlinePrice: 10 },
      { key: '3_kabobs', label: '3 kabobs', onlinePrice: 15, inlinePrice: 13 },
      { key: '4_kabobs', label: '4 kabobs', onlinePrice: 18, inlinePrice: 15 },
    ],
    beef_kabobs: [
      { key: '2_kabobs', label: '2 kabobs', onlinePrice: 12, inlinePrice: 10 },
      { key: '3_kabobs', label: '3 kabobs', onlinePrice: 15, inlinePrice: 13 },
      { key: '4_kabobs', label: '4 kabobs', onlinePrice: 18, inlinePrice: 15 },
    ],
    shrimp_kabobs: [
      { key: '2_kabobs', label: '2 kabobs', onlinePrice: 12, inlinePrice: 10 },
      { key: '3_kabobs', label: '3 kabobs', onlinePrice: 15, inlinePrice: 13 },
      { key: '4_kabobs', label: '4 kabobs', onlinePrice: 18, inlinePrice: 15 },
    ],
  };

  function computeInlineBasePrice(basePrice, itemId) {
    let price = basePrice;

    if (['side_chicken_wing', 'side_chicken_kabob', 'side_beef_kabob', 'side_shrimp_kabob'].includes(itemId)) {
      return 3.0;
    }

    const cents = Math.round(price * 100);
    if (cents % 100 === 50) {
      price = (cents - 50) / 100;
    }

    if (Math.abs(price - 16) < 0.001) {
      price = 15;
    }

    return price;
  }

  function buildBaselinePricing() {
    const allItems = mains.concat(sides);
    const baseline = { items: {}, portions: {} };

    allItems.forEach(item => {
      const inlinePrice = computeInlineBasePrice(item.price, item.id);
      baseline.items[item.id] = {
        inlinePrice,
        onlinePrice: item.price,
        markup: item.price - inlinePrice,
      };
    });

    Object.entries(portionOptions).forEach(([itemId, options]) => {
      baseline.portions[itemId] = {};
      options.forEach(opt => {
        baseline.portions[itemId][opt.key] = {
          inlinePrice: opt.inlinePrice,
          onlinePrice: opt.onlinePrice,
          markup: opt.onlinePrice - opt.inlinePrice,
          label: opt.label,
        };
      });
    });

    return baseline;
  }

  const BASELINE_PRICING = buildBaselinePricing();

  function readNumber(val) {
    const num = parseFloat(val);
    return Number.isFinite(num) ? num : null;
  }

  function loadPriceOverrides() {
    try {
      const raw = localStorage.getItem(PRICE_OVERRIDE_STORAGE_KEY);
      if (!raw) return { items: {}, portions: {} };
      const parsed = JSON.parse(raw);
      return {
        items: parsed.items || {},
        portions: parsed.portions || {},
      };
    } catch (err) {
      console.warn('Could not load price overrides', err);
      return { items: {}, portions: {} };
    }
  }

  function savePriceOverrides(next) {
    try {
      localStorage.setItem(PRICE_OVERRIDE_STORAGE_KEY, JSON.stringify(next || { items: {}, portions: {} }));
    } catch (err) {
      console.warn('Could not save price overrides', err);
    }
  }

  function getEffectivePrices(itemId, portionKey = null, overrides = loadPriceOverrides()) {
    if (portionKey) {
      const base = BASELINE_PRICING.portions?.[itemId]?.[portionKey];
      if (!base) return null;
      const overrideInline = readNumber(overrides.portions?.[itemId]?.[portionKey]);
      const inline = overrideInline != null ? overrideInline : base.inlinePrice;
      const online = inline + base.markup;
      return { inline, online, markup: base.markup };
    }

    const base = BASELINE_PRICING.items?.[itemId];
    if (!base) return null;
    const overrideInline = readNumber(overrides.items?.[itemId]);
    const inline = overrideInline != null ? overrideInline : base.inlinePrice;
    const online = inline + base.markup;
    return { inline, online, markup: base.markup };
  }

  window.KG_MENU_DATA = {
    mains,
    sides,
    portionOptions,
    computeInlineBasePrice,
    getBaselinePricing: () => BASELINE_PRICING,
    getEffectivePrices,
    loadPriceOverrides,
    savePriceOverrides,
    PRICE_OVERRIDE_STORAGE_KEY,
  };
})();