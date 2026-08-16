// api/index.js
import express from 'express';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, push, runTransaction } from 'firebase/database';

// ==========================================
// Firebase Configuration (from your project)
// ==========================================
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

const router = express.Router();

// ==========================================
// Helper Functions
// ==========================================
function generateInvoiceId() {
  return 'INV_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function validatePhone(phone) {
  return /^[0-9]{10}$/.test(phone);
}

// ==========================================
// EXISTING API ENDPOINTS (from your repo)
// ==========================================

// 1. User Signup
router.post('/signup', async (req, res) => {
  try {
    const { phone, password, name } = req.body;
    if (!phone || !password || !name) {
      return res.status(400).json({ status: 'error', message: 'Missing fields' });
    }
    if (!validatePhone(phone)) {
      return res.status(400).json({ status: 'error', message: 'Invalid phone number' });
    }

    const userRef = ref(db, `users/${phone}`);
    const snapshot = await get(userRef);
    if (snapshot.exists()) {
      return res.status(400).json({ status: 'error', message: 'User already exists' });
    }

    await set(userRef, {
      phone,
      password, // plain text – consider hashing with bcrypt in production
      name,
      balance: 0,
      created_at: new Date().toISOString()
    });

    res.json({ status: 'success', message: 'User created' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// 2. User Login
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ status: 'error', message: 'Phone and password required' });
    }

    const userRef = ref(db, `users/${phone}`);
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const user = snapshot.val();
    if (user.password !== password) {
      return res.status(401).json({ status: 'error', message: 'Incorrect password' });
    }

    res.json({
      status: 'success',
      user: {
        phone: user.phone,
        name: user.name,
        balance: user.balance || 0
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// 3. Get Balance
router.get('/balance/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    if (!validatePhone(phone)) {
      return res.status(400).json({ status: 'error', message: 'Invalid phone' });
    }

    const snapshot = await get(ref(db, `users/${phone}`));
    if (!snapshot.exists()) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const user = snapshot.val();
    res.json({ status: 'success', balance: user.balance || 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// 4. Add Money (Deposit)
router.post('/addMoney', async (req, res) => {
  try {
    const { phone, amount, description } = req.body;
    if (!phone || !amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid input' });
    }

    const userRef = ref(db, `users/${phone}`);
    const result = await runTransaction(userRef, (currentData) => {
      if (currentData === null) {
        return { status: 'error', message: 'User not found' };
      }
      currentData.balance = (currentData.balance || 0) + Number(amount);
      return currentData;
    });

    if (result.status === 'error' || !result.committed) {
      return res.status(400).json({ status: 'error', message: result.error || 'Transaction failed' });
    }

    // Log transaction
    const txRef = ref(db, `transactions/${phone}`);
    await push(txRef, {
      type: 'credit',
      amount: Number(amount),
      description: description || 'Added money',
      timestamp: new Date().toISOString()
    });

    res.json({ status: 'success', message: 'Money added successfully', newBalance: result.snapshot.val().balance });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// 5. Transfer Money
router.post('/transfer', async (req, res) => {
  try {
    const { fromPhone, toPhone, amount, password } = req.body;
    if (!fromPhone || !toPhone || !amount || isNaN(amount) || amount <= 0 || !password) {
      return res.status(400).json({ status: 'error', message: 'Invalid input' });
    }
    if (fromPhone === toPhone) {
      return res.status(400).json({ status: 'error', message: 'Cannot transfer to yourself' });
    }

    // Validate sender
    const senderRef = ref(db, `users/${fromPhone}`);
    const senderSnap = await get(senderRef);
    if (!senderSnap.exists()) {
      return res.status(404).json({ status: 'error', message: 'Sender not found' });
    }
    const sender = senderSnap.val();
    if (sender.password !== password) {
      return res.status(401).json({ status: 'error', message: 'Incorrect password' });
    }

    // Validate recipient
    const receiverRef = ref(db, `users/${toPhone}`);
    const receiverSnap = await get(receiverRef);
    if (!receiverSnap.exists()) {
      return res.status(404).json({ status: 'error', message: 'Recipient not found' });
    }

    // Perform transfer with transaction on sender and receiver
    const result = await runTransaction(senderRef, (currentData) => {
      if (currentData === null) {
        return { status: 'error', message: 'Sender data not found' };
      }
      const currentBalance = Number(currentData.balance) || 0;
      if (currentBalance < Number(amount)) {
        return { status: 'error', message: 'Insufficient balance' };
      }
      currentData.balance = currentBalance - Number(amount);
      return currentData;
    });

    if (result.status === 'error' || !result.committed) {
      return res.status(400).json({ status: 'error', message: result.error || 'Transfer failed' });
    }

    // Add to receiver
    await runTransaction(receiverRef, (currentData) => {
      if (currentData === null) {
        return { status: 'error', message: 'Receiver data not found' };
      }
      currentData.balance = (currentData.balance || 0) + Number(amount);
      return currentData;
    });

    // Log transactions
    const txSenderRef = ref(db, `transactions/${fromPhone}`);
    await push(txSenderRef, {
      type: 'debit',
      amount: Number(amount),
      description: `Transfer to ${toPhone}`,
      timestamp: new Date().toISOString()
    });
    const txReceiverRef = ref(db, `transactions/${toPhone}`);
    await push(txReceiverRef, {
      type: 'credit',
      amount: Number(amount),
      description: `Transfer from ${fromPhone}`,
      timestamp: new Date().toISOString()
    });

    res.json({ status: 'success', message: 'Transfer successful' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// 6. Get Transaction History
router.get('/transactions/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    if (!validatePhone(phone)) {
      return res.status(400).json({ status: 'error', message: 'Invalid phone' });
    }

    const snapshot = await get(ref(db, `transactions/${phone}`));
    if (!snapshot.exists()) {
      return res.json({ status: 'success', transactions: [] });
    }

    const transactions = snapshot.val();
    const txList = Object.keys(transactions).map(key => ({
      id: key,
      ...transactions[key]
    }));

    res.json({ status: 'success', transactions: txList.reverse() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// 7. Withdraw Money
router.post('/withdraw', async (req, res) => {
  try {
    const { phone, amount, password } = req.body;
    if (!phone || !amount || isNaN(amount) || amount <= 0 || !password) {
      return res.status(400).json({ status: 'error', message: 'Invalid input' });
    }

    const userRef = ref(db, `users/${phone}`);
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    const user = snapshot.val();
    if (user.password !== password) {
      return res.status(401).json({ status: 'error', message: 'Incorrect password' });
    }

    const result = await runTransaction(userRef, (currentData) => {
      if (currentData === null) {
        return { status: 'error', message: 'User data not found' };
      }
      const currentBalance = Number(currentData.balance) || 0;
      if (currentBalance < Number(amount)) {
        return { status: 'error', message: 'Insufficient balance' };
      }
      currentData.balance = currentBalance - Number(amount);
      return currentData;
    });

    if (result.status === 'error' || !result.committed) {
      return res.status(400).json({ status: 'error', message: result.error || 'Withdrawal failed' });
    }

    // Log transaction
    const txRef = ref(db, `transactions/${phone}`);
    await push(txRef, {
      type: 'debit',
      amount: Number(amount),
      description: 'Withdrawal',
      timestamp: new Date().toISOString()
    });

    res.json({ status: 'success', message: 'Withdrawal successful', newBalance: result.snapshot.val().balance });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// ==========================================
// NEW: PAYMENT RECEIPT FEATURE
// ==========================================

// 8. Create Payment Link
router.get('/api/deposit/create', async (req, res) => {
  try {
    const { Key, amount, order_id, callback_url } = req.query;

    // Validate merchant API key
    const merchantSnap = await get(ref(db, `merchants/${Key}`));
    if (!merchantSnap.exists()) {
      return res.status(401).json({ status: 'error', message: 'Invalid API key' });
    }

    const numericAmount = parseFloat(amount);
    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid amount' });
    }
    if (!order_id || order_id.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'order_id is required' });
    }

    const invoice_id = generateInvoiceId();
    const invoiceData = {
      invoice_id,
      order_id,
      amount: numericAmount,
      api_key: Key,
      callback_url: callback_url || null,
      status: 'pending',
      payer_phone: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };

    await set(ref(db, `invoices/${invoice_id}`), invoiceData);

    const payment_url = `${req.protocol}://${req.get('host')}/checkout/${invoice_id}`;
    res.json({ status: 'success', payment_url });
  } catch (error) {
    console.error('Create payment error:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// 9. Checkout Page (HTML)
router.get('/checkout/:invoice_id', async (req, res) => {
  try {
    const { invoice_id } = req.params;
    const invoiceSnap = await get(ref(db, `invoices/${invoice_id}`));
    if (!invoiceSnap.exists()) {
      return res.status(404).send('Invoice not found');
    }
    const invoice = invoiceSnap.val();

    if (invoice.status !== 'pending') {
      return res.status(400).send('This invoice has already been processed');
    }
    if (new Date() > new Date(invoice.expires_at)) {
      await update(ref(db, `invoices/${invoice_id}`), { status: 'expired' });
      return res.status(400).send('Invoice has expired');
    }

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
});

// 10. Process Payment
router.post('/api/pay', async (req, res) => {
  try {
    const { invoice_id, password } = req.body;

    // 1. Get invoice
    const invoiceSnap = await get(ref(db, `invoices/${invoice_id}`));
    if (!invoiceSnap.exists()) {
      return res.status(404).json({ status: 'error', message: 'Invoice not found' });
    }
    const invoice = invoiceSnap.val();

    if (invoice.status !== 'pending') {
      return res.status(400).json({ status: 'error', message: 'Invoice already processed' });
    }
    if (new Date() > new Date(invoice.expires_at)) {
      await update(ref(db, `invoices/${invoice_id}`), { status: 'expired' });
      return res.status(400).json({ status: 'error', message: 'Invoice expired' });
    }

    // 2. Identify user (phone number must be provided in the request)
    const userPhone = req.body.phone;
    if (!userPhone) {
      return res.status(401).json({ status: 'error', message: 'User phone number required' });
    }

    const userSnap = await get(ref(db, `users/${userPhone}`));
    if (!userSnap.exists()) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }
    const user = userSnap.val();

    // 3. Verify password (plain text – consider using bcrypt)
    if (user.password !== password) {
      return res.status(401).json({ status: 'error', message: 'Incorrect password' });
    }

    // 4. Deduct balance (transaction)
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

    // 5. Mark invoice as paid
    await update(ref(db, `invoices/${invoice_id}`), {
      status: 'paid',
      payer_phone: userPhone,
      updated_at: new Date().toISOString()
    });

    // 6. Callback (if provided)
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

    // 7. Return success
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
});

// 11. Invoice Status
router.get('/api/status/:invoice_id', async (req, res) => {
  try {
    const { invoice_id } = req.params;
    const { Key } = req.query;

    // Validate merchant
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
});

// ==========================================
// Export the router
// ==========================================
export default router;
