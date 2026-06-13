import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, query, orderByChild, equalTo, update, increment } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCXs6oK4gIh2LoZIQk2DRx6vs_uXJ1dTAU",
  authDomain: "tournament-b2107.firebaseapp.com",
  databaseURL: "https://tournament-b2107-default-rtdb.firebaseio.com",
  projectId: "tournament-b2107",
  storageBucket: "tournament-b2107.firebasestorage.app",
  messagingSenderId: "432820947483",
  appId: "1:432820947483:web:59a98c12108f55042e86be",
  measurementId: "G-M12VPSMC98"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const BOT_TOKEN = "8949928597:AAEEowcX3blEediW76oVd80Ma9g1Tp7uptU";

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
        const data = { ...req.query, ...(req.body || {}) };

        if (req.method === 'GET' && Object.keys(data).length === 0) {
            return res.redirect(302, 'http://ng-wallet-pn77.vercel.app');
        }

        // ==========================================
        // API 1: TELEGRAM USERID BALANCE
        // ==========================================
        if (data.tguserid) {
            const tgId = String(data.tguserid).trim();
            const usersRef = ref(db, "users");
            const userSnap = await get(query(usersRef, orderByChild("tgUserId"), equalTo(tgId)));
            
            if (!userSnap.exists()) {
                return res.status(200).json({ status: "error", message: "invalid" });
            }
            
            let userInfo = null;
            userSnap.forEach((child) => {
                userInfo = {
                    phone: child.key,
                    name: child.val().name || "User",
                    balance: Number(child.val().balance) || 0,
                    tgUserId: child.val().tgUserId
                };
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
                    if (!u.isBanned) {
                        usersList.push({
                            name: u.name || "Unknown",
                            phone: child.key,
                            balance: Number(u.balance) || 0
                        });
                    }
                });
            }
            usersList.sort((a, b) => b.balance - a.balance);
            const top3 = usersList.slice(0, 3);
            
            return res.status(200).json({ status: "success", data: top3 });
        }

        // ==========================================
        // API 3: TRANSACTION DETAILS
        // ==========================================
        if (data.transaction) {
            const txnId = String(data.transaction).trim();
            const txnSnap = await get(ref(db, `transactions/${txnId}`));
            
            if (!txnSnap.exists()) {
                return res.status(200).json({ status: "error", message: "invalid" });
            }
            
            return res.status(200).json({ status: "success", data: txnSnap.val() });
        }

        // ==========================================
        // EXISTING PAYMENT API LOGIC
        // ==========================================
        const { key, token, paytm, amount, comment, number, upi_id } = data;
        
        const safeKey = String(key || token || "").trim();
        const safeComment = String(comment || "").trim();
        
        if (!safeKey) {
            return res.status(200).json({ status: "error", message: "invalid" });
        }

        const usersRef = ref(db, "users");
        const adminSnap = await get(query(usersRef, orderByChild("apiKey"), equalTo(safeKey)));
        
        if (!adminSnap.exists()) {
            return res.status(200).json({ status: "error", message: "invalid" });
        }

        let adminPhone = null, adminData = {};
        adminSnap.forEach((child) => { 
            adminPhone = child.key; 
            adminData = child.val() || {}; 
        });

        const currentAdminBal = Number(adminData.balance) || 0;

        // ==========================================
        // EXISTING UPI WITHDRAWAL API
        // ==========================================
        if (upi_id) {
            const withdrawAmount = Number(amount);
            if (isNaN(withdrawAmount) || withdrawAmount < 10) {
                return res.status(200).json({ status: "error", message: "Minimum withdrawal amount is ₹10." });
            }
            if (currentAdminBal < withdrawAmount) {
                return res.status(200).json({ status: "error", message: "Insufficient Balance!" });
            }

            const exactDate = getExactDate();
            const txnId = "TXN" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

            const updates = {};
            updates[`users/${adminPhone}/balance`] = increment(-withdrawAmount);
            
            updates[`transactions/${txnId}`] = { 
                id: txnId, type: "out", title: "API UPI Withdrawal", amount: withdrawAmount, 
                status: "Pending", date: exactDate, timestamp: Date.now(), 
                icon: "fa-university", color: "blue", name: "Bank Withdraw", 
                number: upi_id, senderName: adminData.name || adminPhone,
                senderId: adminPhone, receiverId: "SYSTEM", isApi: true,
                comment: safeComment
            };

            await update(ref(db), updates);

            const settingsSnap = await get(ref(db, "settings"));
            let globalAdminChatId = settingsSnap.exists() ? settingsSnap.val().adminChatId : null;
            let withdrawMsg = `📤 <b>NG SOLUTION API WITHDRAWAL</b> 💼✨\n\n👤 API Owner: <b>${adminData.name || adminPhone}</b>\n💰 Amount: ₹${withdrawAmount}\n🏦 UPI ID: <code>${upi_id}</code>\n💬 Comment: ${safeComment || 'None'}\n🧾 Txn ID: <code>${txnId}</code>\n\n🔹 Please process this API request.`;
            if (globalAdminChatId) sendTelegramMsg(globalAdminChatId, withdrawMsg);

            if (adminData.tgUserId) {
                let userMsg = `🏦 NG SOLUTION API Withdrawal!\nUPI: ${upi_id}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`;
                sendTelegramMsg(adminData.tgUserId, userMsg);
            }

            return res.status(200).json({ 
                status: "success", 
                message: `Withdrawal request of ₹${withdrawAmount} submitted for UPI: ${upi_id}`,
                data: { transaction_id: txnId, amount: withdrawAmount, upi_id: upi_id, comment: safeComment, sender: adminPhone }
            });
        }
        
        // ==========================================
        // EXISTING NORMAL WALLET TRANSFER API
        // ==========================================
        let targetNumber = String(paytm || number || "").trim(); 
        
        if (!targetNumber || !amount) {
            return res.status(200).json({ status: "error", message: "invalid" });
        }

        const withdrawAmount = Number(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
            return res.status(200).json({ status: "error", message: "invalid amount" });
        }

        const customSnap = await get(ref(db, `custom_ids/${targetNumber.toLowerCase()}`));
        if (customSnap.exists()) {
            targetNumber = customSnap.val();
        }

        if (String(adminPhone) === targetNumber) {
            return res.status(200).json({ status: "error", message: "Cannot send payment to your own number!" });
        }

        if (currentAdminBal < withdrawAmount) {
            return res.status(200).json({ status: "error", message: "Insufficient Balance!" });
        }

        const receiverSnap = await get(ref(db, "users/" + targetNumber));
        if (!receiverSnap.exists()) {
            return res.status(200).json({ status: "error", message: "invalid" });
        }
        let receiverData = receiverSnap.val() || {};

        const exactDate = getExactDate();
        const txnId = "TXN" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

        const updates = {};
        updates[`users/${adminPhone}/balance`] = increment(-withdrawAmount);
        updates[`users/${targetNumber}/balance`] = increment(withdrawAmount);

        updates[`transactions/${txnId}`] = { 
            id: txnId, type: "out", title: "API Payment", amount: withdrawAmount, 
            status: "Success", date: exactDate, timestamp: Date.now(), 
            icon: "fa-code", color: "blue", name: receiverData.name || targetNumber, 
            number: targetNumber, senderName: adminData.name || adminPhone,
            senderId: adminPhone, receiverId: targetNumber, isApi: true,
            comment: safeComment
        };

        await update(ref(db), updates);

        let rName = receiverData.name || targetNumber;
        let aName = adminData.name || adminPhone;
        let finalSenderName = `${aName}`;

        if (adminData.tgUserId) {
            let msg = `🤖 NG SOLUTION API Payment Sent!\nTo: ${rName}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`;
            sendTelegramMsg(adminData.tgUserId, msg);
        }
        if (receiverData.tgUserId) {
            let msg = `💰 NG SOLUTION API Payment Received!\nFrom: ${aName}\nAmount: ₹${withdrawAmount}\nTxn ID: ${txnId}`;
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
                sender_name: finalSenderName
            }
        });

    } catch (error) { 
        return res.status(200).json({ status: "error", message: "invalid" }); 
    }
}
