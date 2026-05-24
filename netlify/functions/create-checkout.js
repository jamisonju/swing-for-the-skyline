const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRIMARY_PRICES = {
  '800': 80000,
  '250': 25000,
  '5000': 500000,
  '2500': 250000,
  '1500': 150000,
  '750': 75000,
  '501': 50000,
  '502': 50000,
};

const ADDONS = [
  { field: 'additionalSpots', unitAmount: 25000, name: 'Additional Single Golfer Spot' },
  { field: 'yardsticks', unitAmount: 5000, name: 'Putting Yardstick' },
  { field: 'mulligans', unitAmount: 2500, name: 'Mulligan Package' },
  { field: 'raffleTickets', unitAmount: 2000, name: 'Raffle Ticket' },
];

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseQty(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function buildLineItems(data) {
  const items = [];
  const interestedIn = String(data.interestedIn || '').trim();

  if (!interestedIn || interestedIn === '0') {
    return items;
  }

  const unitAmount = PRIMARY_PRICES[interestedIn];
  if (!unitAmount) {
    throw new Error('Invalid registration selection.');
  }

  const label =
    (data.interestedInLabel && String(data.interestedInLabel).trim()) ||
    'Swing for the Skyline Registration';

  items.push({
    price_data: {
      currency: 'usd',
      unit_amount: unitAmount,
      product_data: { name: label },
    },
    quantity: 1,
  });

  for (const addon of ADDONS) {
    const qty = parseQty(data[addon.field]);
    if (qty > 0) {
      items.push({
        price_data: {
          currency: 'usd',
          unit_amount: addon.unitAmount,
          product_data: { name: addon.name },
        },
        quantity: qty,
      });
    }
  }

  return items;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { error: 'Payment system is not configured. Please try again later.' });
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request body.' });
  }

  if (data.botField) {
    return json(400, { error: 'Unable to process request.' });
  }

  const interestedIn = String(data.interestedIn || '').trim();
  if (interestedIn === '0') {
    return json(400, { error: 'Silent auction donations do not require payment.' });
  }

  const email = String(data.email || '').trim();
  if (!email) {
    return json(400, { error: 'Email address is required.' });
  }

  let lineItems;
  try {
    lineItems = buildLineItems(data);
  } catch (err) {
    return json(400, { error: err.message || 'Invalid registration data.' });
  }

  if (lineItems.length === 0) {
    return json(400, { error: 'No payable items were selected.' });
  }

  const metadata = {
    firstName: String(data.firstName || '').slice(0, 500),
    lastName: String(data.lastName || '').slice(0, 500),
    company: String(data.company || '').slice(0, 500),
    phone: String(data.phone || '').slice(0, 500),
    notes: String(data.notes || '').slice(0, 500),
    backpackDrive: data.backpackDrive ? 'Yes' : 'No',
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: lineItems,
      success_url: 'https://www.swingfortheskyline.com/success',
      cancel_url: 'https://www.swingfortheskyline.com/#register',
      metadata,
    });

    return json(200, { url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return json(500, {
      error: 'Unable to start checkout. Please try again or contact us directly.',
    });
  }
};
