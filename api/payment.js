// api/payment.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, update, runTransaction } from "firebase/database";

// Firebase configuration (copy from your existing files)
const firebaseConfig = {
  apiKey: "AIzaSyDa3GLjZ_MZ5bSJDGneE2QyLmuhRmQ0SDw",
  authDomain: "ng-wallet-77227.firebaseapp.com",
  databaseURL: "https://ng-wallet-77227-default-rtdb.firebaseio.com",
  projectId: "ng-wallet-77227",
  storageBucket: "ng-wallet-77227.firebasestorage.app",
  messagingSenderId: "412589592184",
  appId: "1:412589592184:web:1b3bfc08f67e699e9da78d",
  measurementId: "G-7XQ764S5D3"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Helper: Generate a unique invoice ID
function generateInvoiceId() {
  return 'INV_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// ==========================================
// API 1: CREATE PAYMENT LINK
// ==========================================
export async function createPayment(req, res) {
  try {
    const { Key, amount, order_id, callback_url } = req.query;

    // 1. Validate API Key (Check if merchant exists)
    const merchantSnap = await get(ref(db, `merchants/${Key}`));
    if (!merchantSnap.exists()) {
      return res.status(401).json({ status: 'error', message: 'Invalid API key' });
    }

    // 2. Validate amount and order_id
    const numericAmount = parseFloat(amount);
    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid amount' });
    }
    if (!order_id || order_id.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'order_id is required' });
    }

    // 3. Generate invoice ID and save to database
    const invoice_id = generateInvoiceId();
    const invoiceData = {
      invoice_id,
      order_id,
      amount: numericAmount,
      api_key: Key,
      callback_url: callback_url || null,
      status: 'pending', // pending, paid, expired
      payer_phone: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes expiry
    };

    await set(ref(db, `invoices/${invoice_id}`), invoiceData);

    // 4. Return the payment URL
    const payment_url = `${req.protocol}://${req.get('host')}/checkout/${invoice_id}`;
    res.json({ status: 'success', payment_url });

  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

// ==========================================
// API 2: GET CHECKOUT PAGE (HTML)
// ==========================================
export async function getCheckoutPage(req, res) {
  try {
    const { invoice_id } = req.params;

    // 1. Fetch invoice details
    const invoiceSnap = await get(ref(db, `invoices/${invoice_id}`));
    if (!invoiceSnap.exists()) {
      return res.status(404).send('Invoice not found');
    }
    const invoice = invoiceSnap.val();

    // 2. Check if invoice is still valid
    if (invoice.status !== 'pending') {
      return res.status(400).send('This invoice has already been processed');
    }
    if (new Date() > new Date(invoice.expires_at)) {
      await update(ref(db, `invoices/${invoice_id}`), { status: 'expired' });
      return res.status(400).send('Invoice has expired');
    }

    // 3. Render a simple HTML checkout page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Checkout</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
          .card { border: 1px solid #ddd; padding: 20px; border-radius: 10px; }
          .amount { font-size: 24px; color: #2a7de1; }
          input { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
          button { background: #2a7de1; color: white; padding: 10px; border: none; width: 100%; cursor: pointer; }
          .error { color: red; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Pay Invoice</h2>
          <p>Order ID: <strong>${invoice.order_id}</strong></p>
          <p>Amount: <span class="amount">₹${invoice.amount.toFixed(2)}</span></p>
          <form action="/api/pay" method="POST">
            <input type="hidden" name="invoice_id" value="${invoice.invoice_id}" />
            <label>Enter your wallet password:</label>
            <input type="password" name="password" required placeholder="Your password" />
            <button type="submit">Pay Now</button>
          </form>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Checkout page error:', error);
    res.status(500).send('Internal server error');
  }
}

// ==========================================
// API 3: PROCESS PAYMENT
// ==========================================
export async function processPayment(req, res) {
  try {
    const { invoice_id, password } = req.body;

    // 1. Get invoice
    const invoiceSnap = await get(ref(db, `invoices/${invoice_id}`));
    if (!invoiceSnap.exists()) {
      return res.status(404).json({ status: 'error', message: 'Invoice not found' });
    }
    const invoice = invoiceSnap.val();

    // 2. Validate invoice status
    if (invoice.status !== 'pending') {
      return res.status(400).json({ status: 'error', message: 'Invoice already processed' });
    }
    if (new Date() > new Date(invoice.expires_at)) {
      await update(ref(db, `invoices/${invoice_id}`), { status: 'expired' });
      return res.status(400).json({ status: 'error', message: 'Invoice expired' });
    }

    // 3. Identify the user (phone number from request body)
    //    In your Telegram bot, you'd pass the user's phone number here.
    const userPhone = req.body.phone; // Expecting phone number in request
    if (!userPhone) {
      return res.status(401).json({ status: 'error', message: 'User phone number required' });
    }

    // 4. Get user data
    const userSnap = await get(ref(db, `users/${userPhone}`));
    if (!userSnap.exists()) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    const user = userSnap.val();

    // 5. Verify password (plain text for now - you should use bcrypt in production)
    if (user.password !== password) {
      return res.status(401).json({ status: 'error', message: 'Incorrect password' });
    }

    // 6. Check and deduct balance using a transaction
    const userRef = ref(db, `users/${userPhone}`);
    const result = await runTransaction(userRef, (currentData) => {
      if (currentData === null) {
        return { status: 'error', message: 'User data not found' };
      }
      const currentBalance = Number(currentData.balance) || 0;
      if (currentBalance < invoice.amount) {
        return { status: 'error', message: 'Insufficient balance' };
      }
      currentData.balance = currentBalance - invoice.amount;
      return currentData;
    });

    if (result.status === 'error' || !result.committed) {
      return res.status(400).json({ status: 'error', message: result.error || 'Transaction failed' });
    }

    // 7. Mark invoice as paid
    await update(ref(db, `invoices/${invoice_id}`), {
      status: 'paid',
      payer_phone: userPhone,
      updated_at: new Date().toISOString()
    });

    // 8. (Optional) Callback to merchant
    if (invoice.callback_url) {
      try {
        await fetch(invoice.callback_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoice_id: invoice.invoice_id,
            order_id: invoice.order_id,
            amount: invoice.amount,
            status: 'paid'
          })
        });
      } catch (e) {
        console.error('Callback failed:', e.message);
      }
    }

    // 9. Return success response
    res.json({
      status: 'success',
      inv_status: 'paid',
      amount: invoice.amount,
      payer_mobile: userPhone
    });

  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
}

// ==========================================
// API 4: GET INVOICE STATUS
// ==========================================
export async function getInvoiceStatus(req, res) {
  try {
    const { invoice_id } = req.params;
    const { Key } = req.query;

    // Validate API key (optional but recommended)
    const merchantSnap = await get(ref(db, `merchants/${Key}`));
    if (!merchantSnap.exists()) {
      return res.status(401).json({ status: 'error', message: 'Invalid API key' });
    }

    const invoiceSnap = await get(ref(db, `invoices/${invoice_id}`));
    if (!invoiceSnap.exists()) {
      return res.status(404).json({ status: 'error', message: 'Invoice not found' });
    }
    const invoice = invoiceSnap.val();

    res.json({
      status: 'success',
      inv_status: invoice.status,
      amount: invoice.amount,
      payer_mobile: invoice.payer_phone || null
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
              }
