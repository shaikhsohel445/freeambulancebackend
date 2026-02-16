/**
 * Cloudflare Worker - Payment Collection API
 * 
 * Endpoints:
 *   GET  /api/next-amount    - Get the next payable amount
 *   POST /api/create-order   - Create a Razorpay order
 *   POST /api/verify-payment - Verify payment and store record
 * 
 * Environment bindings:
 *   DB         - Cloudflare D1 database
 *   RZP_KEY_ID - Razorpay Key ID
 *   RZP_SECRET - Razorpay Secret Key
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------- Helpers ----------

async function getNextOrderInfo(db) {
  const row = await db
    .prepare("SELECT total_orders FROM counter WHERE id = 1")
    .first();
  const totalOrders = row ? row.total_orders : 0;
  return { totalOrders, nextAmount: (totalOrders + 1) * 10 };
}

async function createRazorpayOrder(amount, env) {
  const auth = btoa(`${env.RZP_KEY_ID}:${env.RZP_SECRET}`);
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: amount * 100, // paise
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    }),
  });
  if (!res.ok) throw new Error("Razorpay order creation failed");
  return res.json();
}

async function verifySignature(orderId, paymentId, signature, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = encoder.encode(`${orderId}|${paymentId}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computed === signature;
}

// ---------- Route Handlers ----------

async function handleNextAmount(db) {
  const { nextAmount } = await getNextOrderInfo(db);
  return jsonResponse({ nextAmount });
}

async function handleCreateOrder(request, env) {
  const { name, mobile, address, amount } = await request.json();

  if (!name || !mobile || !address) {
    return jsonResponse({ error: "All fields are required" }, 400);
  }
  if (!/^\d{10}$/.test(mobile)) {
    return jsonResponse({ error: "Invalid mobile number" }, 400);
  }
  if (!amount || typeof amount !== 'number' || amount < 10) {
    return jsonResponse({ error: "Invalid amount. Minimum amount is ₹10" }, 400);
  }

  const order = await createRazorpayOrder(amount, env);

  return jsonResponse({
    order_id: order.id,
    amount: amount,
    key: env.RZP_KEY_ID,
  });
}

async function handleVerifyPayment(request, env) {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    name,
    mobile,
    address,
    amount,
  } = await request.json();

  // Verify signature
  const isValid = await verifySignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    env.RZP_SECRET
  );

  if (!isValid) {
    return jsonResponse({ error: "Invalid payment signature" }, 400);
  }

  // Atomic counter increment + insert
  const db = env.DB;

  await db.exec("BEGIN TRANSACTION");
  try {
    await db
      .prepare("UPDATE counter SET total_orders = total_orders + 1 WHERE id = 1")
      .run();

    const counterRow = await db
      .prepare("SELECT total_orders FROM counter WHERE id = 1")
      .first();
    const orderNumber = counterRow.total_orders;

    await db
      .prepare(
        `INSERT INTO payments (order_number, name, mobile, address, amount, razorpay_order_id, razorpay_payment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(orderNumber, name, mobile, address, amount, razorpay_order_id, razorpay_payment_id)
      .run();

    await db.exec("COMMIT");

    return jsonResponse({ status: "success", orderNumber });
  } catch (err) {
    await db.exec("ROLLBACK");
    return jsonResponse({ error: "Database error: " + err.message }, 500);
  }
}

// ---------- Main Entry ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      switch (url.pathname) {
        case "/api/next-amount":
          return handleNextAmount(env.DB);
        case "/api/create-order":
          return handleCreateOrder(request, env);
        case "/api/verify-payment":
          return handleVerifyPayment(request, env);
        default:
          return jsonResponse({ error: "Not found" }, 404);
      }
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  },
};
