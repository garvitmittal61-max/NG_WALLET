import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, query, orderByChild, equalTo, update, increment } from "firebase/database";

// NEW DATABASE CONFIGURATION
const firebaseConfig = {
  apiKey: "AIzaSyCbP79K6qh0NYiG7aECjE0yFkyUbf1ETMo",
  authDomain: "ng-wallet-1ef7e.firebaseapp.com",
  databaseURL: "https://ng-wallet-1ef7e-default-rtdb.firebaseio.com",
  projectId: "ng-wallet-1ef7e",
  storageBucket: "ng-wallet-1ef7e.firebasestorage.app",
  messagingSenderId: "535409185016",
  appId: "1:535409185016:web:2572a5edaeb80266302b0d"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// NEW BOT TOKEN
const BOT_TOKEN = "8949928597:AAEwJXfEzzLKs_YlBvLIt3Gowk3HLL1fsL4";

function getExactDate() {
    return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

async function sendTelegramMsg(chatId, text) {
    try {
        if (!chatId) return false;
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
        });
        return true;
    } catch (e) { return false; }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // Collect parameters from either GET (req.query) or POST (req.body)
        const data = { ...req.query, ...(req.body || {}) };

        // REDIRECT FIX: If someone visits the API URL without any valid parameters, redirect to the home page.
        if (req.method === 'GET' && !req.query.key && !req.query.token && !req.query.tguserid && !req.query.transaction && req.query.leaderboard === undefined) {
            return res.redirect(302, 'http://ng-wallet-pn77.vercel.app');
        }

        // ==========================================
        // API 1: TELEGRAM USERID BALANCE
        // ==========================================
        if (data.tguserid) {
            const tgId = String(data.tguserid).trim();
            const usersRef = ref(db, "users");
            const userSnap = await get(query(usersRef, orderByChild("tgUserId"), equalTo(tgId)));
            
            if (!userSnap.exists()) return res.status(200).json({ status: "error", message: "invalid user" });
            
            let userInfo = null;
            userSnap.forEach((child) => {
                userInfo = { phone: child.key, name: child.val().name || "User", balance: Number(child.val().balance) || 0, tgUserId: child.val().tgUserId };
            });
            return res.status(200).json({ status: "success", data: userInfo });
        }

        // ==========================================
        // API 2: LEADERBOARD TOP 3 USERS
        // ==========================================
        if (data.leaderboard !== undefined) {
            const usersSnap = await get(ref(db, "users"));
            let usersList = [];
            if (usersSnap.exists()) {
                usersSnap.forEach((child) => {
                    const u = child.val();
                    if (!u.isBanned) usersList.push({ name: u.name || "Unknown", phone: child.key, balance: Number(u.balance) || 0 });
                });
            }
            usersList.sort((a, b) => b.balance - a.balance);
            return res.status(200).json({ status: "success", data: usersList.slice(0, 3) });
        }

        // ==========================================
        // API 3: TRANSACTION DETAILS
        // ==========================================
        if (data.transaction) {
            const txnId = String(data.transaction).trim();
            const txnSnap = await get(ref(db, `transactions/${txnId}`));
            if (!txnSnap.exists()) return res.status(200).json({ status: "error", message: "invalid transaction" });
            return res.status(200).json({ status: "success", data: txnSnap.val() });
        }

        // ==========================================
        // EXTERNAL API: PAYMENTS & WITHDRAWALS LOGIC
        // ==========================================
        const { key, token, paytm, amount, comment, number, upi_id } = data;
        
        // Allows both "key=" and "token=" from the GET URL parameters
        const safeKey = String(key || token || "").trim();
        const safeComment = String(comment || "").trim();
        
        if (!safeKey) return res.status(200).json({ status: "error", message: "API key is required" });

        // Authenticate the API Key
        const usersRef = ref(db, "users");
        const adminSnap = await get(query(usersRef, orderByChild("apiKey"), equalTo(safeKey)));
        
        if (!adminSnap.exists()) return res.status(200).json({ status: "error", message: "Invalid API Key" });

        let adminPhone = null, adminData = {};
        adminSnap.forEach((child) => { 
            adminPhone = child.key; 
            adminData = child.val() || {}; 
        });

        const currentAdminBal = Number(adminData.balance) || 0;

        // ==========================================
        // API WITHDRAWAL REQUEST (If upi_id is present)
        // ==========================================
        if (upi_id) {
            const withdrawAmount = Number(amount);
            if (isNaN(withdrawAmount) || withdrawAmount < 10) return res.status(200).json({ status: "error", message: "Minimum withdrawal amount is ₹10." });
            if (currentAdminBal < withdrawAmount) return res.status(200).json({ status: "error", message: "Insufficient Balance in your API Wallet!" });

            const exactDate = getExactDate();
            const txnId = "TXN" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

            const updates = {};
            updates[`users/${adminPhone}/balance`] = increment(-withdrawAmount);
            
            updates[`transactions/${txnId}`] = { 
                id: txnId, type: "out", title: "API UPI Withdrawal", amount: withdrawAmount, 
                status: "Pending", date: exactDate, timestamp: Date.now(), 
                icon: "fa-university", color: "blue", name: "Bank Withdraw", 
                number: upi_id, senderName: adminData.name || adminPhone,
                senderId: adminPhone, receiverId: "SYSTEM", isApi: true, comment: safeComment
            };

            await update(ref(db), updates);

            // Send Telegram Alert
            if (adminData.tgUserId) {
                let userMsg = `🏦 <b>NG SOLUTION API Withdrawal!</b>\nUPI: <code>${upi_id}</code>\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`;
                sendTelegramMsg(adminData.tgUserId, userMsg);
            }

            return res.status(200).json({ 
                status: "success", 
                message: `Withdrawal request of ₹${withdrawAmount} submitted successfully for UPI: ${upi_id}`,
                data: { transaction_id: txnId, amount: withdrawAmount, upi_id: upi_id, comment: safeComment, sender: adminPhone }
            });
        }
        
        // ==========================================
        // API PAYMENT TRANSFER (If paytm or number is present)
        // ==========================================
        let targetNumber = String(paytm || number || "").trim(); 
        
        if (!targetNumber || !amount) {
            return res.status(200).json({ status: "error", message: "Target number (paytm parameter) and amount are required." });
        }

        const withdrawAmount = Number(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) return res.status(200).json({ status: "error", message: "Invalid amount provided." });

        // Resolve Custom ID if a username was passed instead of phone number
        const customSnap = await get(ref(db, `custom_ids/${targetNumber.toLowerCase()}`));
        if (customSnap.exists()) targetNumber = customSnap.val();

        if (String(adminPhone) === targetNumber) return res.status(200).json({ status: "error", message: "Cannot send payment to your own API number!" });
        if (currentAdminBal < withdrawAmount) return res.status(200).json({ status: "error", message: "Insufficient Balance in your API Wallet!" });

        // Verify the receiver exists
        const receiverSnap = await get(ref(db, "users/" + targetNumber));
        if (!receiverSnap.exists()) return res.status(200).json({ status: "error", message: "Receiver account not found in NG SOLUTION." });
        
        let receiverData = receiverSnap.val() || {};

        const exactDate = getExactDate();
        const txnId = "TXN" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

        const updates = {};
        // Deduct from Sender, Add to Receiver
        updates[`users/${adminPhone}/balance`] = increment(-withdrawAmount);
        updates[`users/${targetNumber}/balance`] = increment(withdrawAmount);

        updates[`transactions/${txnId}`] = { 
            id: txnId, type: "out", title: "API Payment", amount: withdrawAmount, 
            status: "Success", date: exactDate, timestamp: Date.now(), 
            icon: "fa-code", color: "blue", name: receiverData.name || targetNumber, 
            number: targetNumber, senderName: adminData.name || adminPhone,
            senderId: adminPhone, receiverId: targetNumber, isApi: true, comment: safeComment
        };

        await update(ref(db), updates);

        let rName = receiverData.name || targetNumber;
        let aName = adminData.name || adminPhone;

        // Send Telegram Alerts
        if (adminData.tgUserId) {
            let msg = `🤖 <b>NG SOLUTION API Payment Sent!</b>\nTo: ${rName}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`;
            sendTelegramMsg(adminData.tgUserId, msg);
        }
        if (receiverData.tgUserId) {
            let msg = `💰 <b>NG SOLUTION API Payment Received!</b>\nFrom: ${aName}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`;
            sendTelegramMsg(receiverData.tgUserId, msg);
        }

        return res.status(200).json({ 
            status: "success", 
            message: `Payment successful to ${targetNumber}`,
            data: { 
                transaction_id: txnId, 
                amount: withdrawAmount, 
                receiver: targetNumber,
                comment: safeComment,
                sender: adminPhone,
                sender_name: aName
            }
        });

    } catch (error) { 
        return res.status(500).json({ status: "error", message: "An internal server error occurred." }); 
    }
}
