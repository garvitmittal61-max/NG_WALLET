const API_URL = '/api/backend';
const BOT_TOKEN = "8949928597:AAHE1aY8qjxhHyH6kJuJKGWescYlsihgIqM";

let currentUser = null, pendingSignupUser = null, pendingOTP = null, otpMode = 'signup', resetPinPhone = null;
let globalSettings = {}, knownTxnStatuses = {}, transactions = [];
let currentBalance = 0, keeperBalance = 0;
let lastRenderedBalance = null, lastRenderedKeeper = null;
let officialPosts = [];
let lastSeenPostTimestamp = localStorage.getItem('lastSeenPost') || 0;
let isBalanceVisible = true; 

let html5QrcodeScanner = null;
let uploadedScreenshotBase64 = null;

// Public Lifafa State
let currentLifafaId = null, currentLifafaDetails = null, lifafaClaimerPhone = null, lifafaClaimerTgId = null, lifafaReferrerPhone = null;

const sndClick = new Audio("https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3");
const sndSuccess = new Audio("https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3"); 
const sndCredit = new Audio("https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3"); 
const sndDebit = new Audio("https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3");  
const sndAdmin = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");

function playSound(type) {
    if(localStorage.getItem('lp_sound') === 'false') return;
    try { 
        if(type === 'click') sndClick.play();
        else if(type === 'credit') sndCredit.play();
        else if(type === 'debit') sndDebit.play();
        else if(type === 'admin') sndAdmin.play();
        else if(type === 'success') sndSuccess.play();
    } catch(e){}
}

document.addEventListener('click', () => { playSound('click'); });

let isActionOnCooldown = false;
function checkCooldown() {
    if (isActionOnCooldown) { showToast("Please wait 3 seconds before next action!"); return false; }
    isActionOnCooldown = true; setTimeout(() => { isActionOnCooldown = false; }, 3000); return true;
}

async function apiCall(action, data = {}) {
    try {
        let res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
        const responseText = await res.text();
        let result;
        try { result = JSON.parse(responseText); } catch (e) { throw new Error("API Not Found or Offline."); }
        if(!res.ok || result.error) throw new Error(result.error || "Server error");
        return result.data;
    } catch(err) { if(err.message !== "invalid") showToast(err.message); throw err; }
}

async function sendTelegramMsg(chatId, text, isTxnAlert = true) {
    try {
        if(!chatId) return false;
        if (isTxnAlert && currentUser && currentUser.botAlerts === false) { return true; }
        let res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' }) }); 
        return (await res.json()).ok;
    } catch (e) { return false; }
}

function formatTgMsg(type, title, amount, extra) {
    return `🔔 <b>NG SOLUTION Alert</b>\n\n📝 ${title}\n💰 Amount: ₹${amount}\nℹ️ ${extra}`;
}

function formatDateTime() { return new Date().toLocaleString('en-IN', { hour12: true, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function generateApiKey() { return 'NG-' + Math.random().toString(36).substring(2, 10).toUpperCase(); }
function generateTxnId() { return 'TXN' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase(); }
function checkSecurityPin(inputPin) { if(inputPin === currentUser?.pin) return true; showToast("Incorrect Security PIN!"); return false; }

function updateApiKeyUI() {
    let key = currentUser?.apiKey || 'NG-PENDING'; 
    let elUrlFull = document.getElementById('ui-api-url-full'); 
    if(elUrlFull) elUrlFull.innerHTML = `http://ng-wallet-pn77.vercel.app/api?key=<span class="accent-text">${key}</span>&paytm=<span class="text-green-500">{number}</span>&amount=<span class="text-green-500">{amount}</span>&comment=<span class="text-green-500">{comment}</span>`;
    let elUrlUpi = document.getElementById('ui-api-url-upi'); 
    if(elUrlUpi) elUrlUpi.innerHTML = `http://ng-wallet-pn77.vercel.app/api/upi.php?token=<span class="accent-text">${key}</span>&upi_id=<span class="text-green-500">{upi_id}</span>&amount=<span class="text-green-500">{amount}</span>&comment=<span class="text-green-500">{comment}</span>`;

    let elDisp = document.getElementById('ui-api-key-display'); 
    if(elDisp) elDisp.value = key; // Fix for loading issue
}

async function saveCustomApiKey() {
    let newKey = document.getElementById('custom-api-input').value.trim();
    if(!newKey) return showToast("Enter an API Key");
    if(/\s/.test(newKey) || !/^[a-zA-Z0-9_-]+$/.test(newKey)) return showToast("Spaces not allowed. Use letters, numbers, -, _");
    try {
        await apiCall('SET_CUSTOM_API', { phone: currentUser?.phone, newKey: newKey });
        if(currentUser) currentUser.apiKey = newKey; 
        updateApiKeyUI(); showToast("Custom API Key Saved!");
        document.getElementById('custom-api-input').value = '';
    } catch(e) {}
}

async function regenerateApiKey() {
    if(!confirm("Are you sure? Old API key will stop working immediately.")) return;
    let newKey = generateApiKey(); await apiCall('GENERATE_API', { phone: currentUser?.phone, newKey });
    if(currentUser) currentUser.apiKey = newKey; 
    updateApiKeyUI(); showToast("API Key Regenerated!");
}

function showAuthView(view) { ['login', 'signup', 'otp', 'reset-pin'].forEach(v => document.getElementById('auth-' + v).classList.add('hidden')); document.getElementById('auth-' + view).classList.remove('hidden'); }
function logoutUser() { localStorage.removeItem('ngSession'); currentUser = null; location.reload(); }

async function checkAuth() {
    let sessionPhone = localStorage.getItem('ngSession');
    if (sessionPhone) {
        try {
            let user = await apiCall('CHECK_USER', { phone: sessionPhone });
            if (user) {
                currentUser = user; currentUser.phone = sessionPhone;
                if(currentUser.isBanned) { document.getElementById('banned-wrapper').classList.remove('hidden'); document.getElementById('banned-wrapper').style.display = 'flex'; return; }
                if (!currentUser.apiKey) { currentUser.apiKey = generateApiKey(); await apiCall('GENERATE_API', { phone: currentUser.phone, newKey: currentUser.apiKey }); }
                document.getElementById('auth-wrapper').classList.add('hidden'); initApp();
            } else { logoutUser(); }
        } catch(e) { logoutUser(); }
    } else { document.getElementById('auth-wrapper').classList.remove('hidden'); showAuthView('login'); }
}

async function processLogin() {
    let phone = document.getElementById('login-phone').value; let pass = document.getElementById('login-pass').value;
    try { 
        let user = await apiCall('LOGIN', { phone, password: pass }); 
        localStorage.setItem('ngSession', phone); currentUser = user; currentUser.phone = phone; 
        if (!currentUser.apiKey) { currentUser.apiKey = generateApiKey(); await apiCall('GENERATE_API', { phone: currentUser.phone, newKey: currentUser.apiKey }); } 
        document.getElementById('auth-wrapper').classList.add('hidden'); initApp(); 
    } catch(e) {}
}

async function processSignupStep1() {
    let name = document.getElementById('reg-name').value; 
    let phone = document.getElementById('reg-phone').value; 
    let email = document.getElementById('reg-email').value; 
    let pass = document.getElementById('reg-pass').value; 
    let pin = document.getElementById('reg-pin').value; 
    let telegram = document.getElementById('reg-telegram').value;
    try {
        let exists = await apiCall('CHECK_USER', { phone }); if(exists) return showToast("Phone number already registered!");
        let joinDate = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        
        pendingSignupUser = { name, email, password: pass, pin, tgUserId: telegram, isBanned: false, balance: 0, keeperBalance: 0, apiKey: generateApiKey(), botAlerts: true, memberSince: joinDate }; 
        pendingSignupUser.phone = phone; pendingOTP = Math.floor(100000 + Math.random() * 900000).toString(); otpMode = 'signup';
        
        let btn = document.getElementById('btn-signup-otp'); btn.innerText = "SENDING..."; btn.disabled = true;
        let success = await sendTelegramMsg(telegram, `🔐 Your OTP Code\n📲 OTP: <b>${pendingOTP}</b>\n🤖 @NG_WALLET_BOT`, false); btn.innerText = "SEND OTP TO TELEGRAM"; btn.disabled = false;
        if(success) { showToast("OTP Sent to Telegram!"); showAuthView('otp'); } else { alert("Could not send OTP. Start the @NG_WALLET_BOT first!"); }
    } catch(e) {}
}

async function processResetPinStep1() {
    resetPinPhone = document.getElementById('reset-phone').value;
    try {
        let user = await apiCall('CHECK_USER', { phone: resetPinPhone }); if(!user) return showToast("User not found!");
        pendingOTP = Math.floor(100000 + Math.random() * 900000).toString(); otpMode = 'reset_pin';
        let success = await sendTelegramMsg(user.tgUserId, `🔐 Your OTP Code\n📲 OTP: <b>${pendingOTP}</b>`, false);
        if(success) { showToast("OTP Sent to Telegram!"); showAuthView('otp'); } else { alert("Failed to send OTP. Start @NG_WALLET_BOT first."); }
    } catch(e) {}
}

async function processResetPinStep2() {
    let newPass = document.getElementById('reset-new-pass').value; let newPin = document.getElementById('reset-new-pin').value;
    await apiCall('UPDATE_CREDS', { phone: resetPinPhone, password: newPass, pin: newPin }); showToast("Updated successfully!"); showAuthView('login');
}

async function verifyOTP() {
    let userOTP = document.getElementById('otp-input').value;
    if(userOTP === pendingOTP) {
        if(otpMode === 'signup') {
            let userPhone = pendingSignupUser.phone; let dbUser = { ...pendingSignupUser }; delete dbUser.phone;
            await apiCall('REGISTER', { phone: userPhone, userObj: dbUser }); localStorage.setItem('ngSession', userPhone); currentUser = pendingSignupUser; document.getElementById('auth-wrapper').classList.add('hidden'); initApp(); showToast("Account Created!");
        } else if (otpMode === 'reset_pin') { document.getElementById('form-reset-1').classList.add('hidden'); document.getElementById('form-reset-2').classList.remove('hidden'); showAuthView('reset-pin'); }
    } else { showToast("Invalid OTP!"); }
}

function createTxnObj(type, title, amount, status, icon, color, name, number) { return { id: generateTxnId(), type, title, amount, status, date: new Date().toLocaleString(), timestamp: Date.now(), icon, color, name, number, senderName: currentUser?.name || 'User', senderId: type==='out'?(currentUser?.phone||'SYSTEM'):(number!=='N/A'?number:'SYSTEM'), receiverId: type==='in'?(currentUser?.phone||'SYSTEM'):(number!=='N/A'?number:'SYSTEM') }; }

async function syncLoop() {
    if(!currentUser) return;
    await syncData();
    setTimeout(syncLoop, 3000); 
}

async function syncData() {
    if(!currentUser) return;
    try {
        let data = await apiCall('SYNC', { phone: currentUser.phone });
        if(data.user) {
            if(data.user.isBanned) return location.reload();
            let savedPhone = currentUser.phone; let prevBalance = currentBalance;
            currentUser = data.user; currentUser.phone = savedPhone;
            currentBalance = data.user.balance || 0;
            keeperBalance = data.user.keeperBalance || 0;
            
            if (currentBalance > prevBalance) playSound('credit');
            else if (currentBalance < prevBalance && !isActionOnCooldown) playSound('debit');
            if(data.user.apiKey && data.user.apiKey !== currentUser.apiKey) { currentUser.apiKey = data.user.apiKey; updateApiKeyUI(); }
        }
        if(data.settings) {
            globalSettings = data.settings;
            if(globalSettings.upiId) { 
                let upiEl = document.getElementById('ui-upi-id'); 
                if(upiEl) upiEl.innerText = globalSettings.upiId; 
                
                // Add Funds QR Code Generation Fix
                let depositQrEl = document.getElementById('deposit-qr-img');
                if(depositQrEl && (!depositQrEl.src || !depositQrEl.src.includes('api.qrserver.com'))) {
                    depositQrEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=${globalSettings.upiId}&pn=NG%20SOLUTION`;
                }
            }
            if(globalSettings.maintenance) { document.getElementById('maintenance-wrapper').classList.remove('hidden'); document.getElementById('maintenance-wrapper').style.display = 'flex'; } else { document.getElementById('maintenance-wrapper').classList.add('hidden'); }
            
            let supportUrl = globalSettings.supportUser ? (globalSettings.supportUser.startsWith('http') ? globalSettings.supportUser : 'https://t.me/' + globalSettings.supportUser.replace('@', '')) : "https://t.me/NG_SOLUTION_SUPPORT";
            let btnSupport = document.getElementById('help-support-link'); 
            if(btnSupport) btnSupport.onclick = () => window.open(supportUrl, '_blank');
        }
        if(data.txns) {
            transactions = data.txns || [];
            transactions.forEach(t => {
                if (knownTxnStatuses[t.id] && knownTxnStatuses[t.id] === 'Pending' && t.status !== 'Pending') { showToast(`Status Update: ${t.title} is now ${t.status}`); }
                knownTxnStatuses[t.id] = t.status;
            });
        }
        if(data.posts) {
            officialPosts = data.posts || [];
            if (officialPosts.length > 0) {
                let sortedDesc = [...officialPosts].sort((a,b) => b.timestamp - a.timestamp);
                let latestPost = sortedDesc[0];
                if (lastSeenPostTimestamp < latestPost.timestamp) {
                    lastSeenPostTimestamp = latestPost.timestamp; localStorage.setItem('lastSeenPost', lastSeenPostTimestamp);
                    const popup = document.getElementById('new-message-popup');
                    if(popup) { popup.classList.remove('hidden'); popup.classList.add('flex'); playSound('admin'); setTimeout(() => { popup.classList.add('opacity-0'); setTimeout(() => { popup.classList.add('hidden'); popup.classList.remove('flex', 'opacity-0'); }, 500); }, 3000); }
                }
            }
            if (document.getElementById('view-official') && document.getElementById('view-official').classList.contains('active')) { renderOfficialPosts(); }
        }
        updateUI(); updateStatsDashboard();
    } catch(e) { console.error("Sync Error:", e); }
}

function maskPhone(phone) {
    if(!phone || phone.length < 10) return phone;
    return phone.substring(0, 3) + "••••••" + phone.substring(phone.length - 2); 
}

function maskEmail(email) {
    if(!email || !email.includes('@')) return email;
    let parts = email.split('@'); let name = parts[0];
    if(name.length > 3) name = name.substring(0, 3) + "***";
    return name + "@" + parts[1];
}

let sendResolvedPhone = null; let debounceTimer;
let sNumEl = document.getElementById('send-num');
if(sNumEl) {
    sNumEl.addEventListener('input', function() {
        clearTimeout(debounceTimer); let val = this.value.trim();
        let nameField = document.getElementById('send-name');
        if(val.length >= 3) {
            nameField.innerHTML = "Fetching...";
            debounceTimer = setTimeout(async () => {
                try { 
                    let user = await apiCall('CHECK_USER', { phone: val }); 
                    if(user) {
                        sendResolvedPhone = user.resolvedPhone || user.phone;
                        let dpUrl = user.dp || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name)}`;
                        let tagToShow = user.customUserTag || user.tag || 'MEMBER';
                        nameField.className = "w-full rounded-xl px-4 py-3 text-sm mb-5 font-bold cursor-not-allowed transition-all flex items-center justify-between min-h-[64px] bg-slate-100 text-slate-800 border border-slate-200";
                        nameField.innerHTML = `
                            <div class="flex items-center gap-3">
                                <img src="${dpUrl}" class="w-10 h-10 rounded-full object-cover border-2 border-blue-500">
                                <div class="text-left"><p class="font-black text-sm flex items-center gap-1">${user.name}</p><p class="text-[9px] text-gray-400 uppercase font-black tracking-widest">${tagToShow}</p></div>
                            </div>`;
                    } else { nameField.innerHTML = 'User Not Found'; sendResolvedPhone = null; }
                } catch(e) { nameField.innerHTML = 'Error'; }
            }, 500);
        } else { nameField.innerHTML = ''; sendResolvedPhone = null; }
    });
}

function renderOfficialPosts() {
    const container = document.getElementById('official-posts-container'); if(!container) return;
    container.innerHTML = '';
    if (officialPosts.length === 0) { container.innerHTML = '<p class="text-center text-gray-400 mt-10 text-sm font-bold">No official posts yet</p>'; return; }
    let sortedPosts = [...officialPosts].sort((a,b) => a.timestamp - b.timestamp);
    sortedPosts.forEach(post => {
        let timeStr = new Date(post.timestamp).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
        container.innerHTML += `
            <div class="flex gap-3 max-w-[85%]">
                <div class="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center shrink-0 border border-blue-200 mt-1 shadow-sm"><i class="fas fa-user-shield text-[10px]"></i></div>
                <div class="theme-card rounded-2xl rounded-tl-none p-3 shadow-sm border border-gray-100 relative">
                    <p class="text-[10px] font-black text-blue-600 mb-1">ADMIN</p>
                    <p class="text-sm font-medium whitespace-pre-wrap">${post.text}</p>
                    <p class="text-[9px] text-gray-400 mt-2 text-right">${timeStr}</p>
                </div>
            </div>`;
    });
}

function markPostsAsRead() {
    if (officialPosts.length > 0) {
        let sortedDesc = [...officialPosts].sort((a,b) => b.timestamp - a.timestamp);
        lastSeenPostTimestamp = sortedDesc[0].timestamp; localStorage.setItem('lastSeenPost', lastSeenPostTimestamp);
    }
    let popup = document.getElementById('new-message-popup'); if(popup) { popup.classList.add('hidden'); popup.classList.remove('flex'); }
}

async function editProfileName() {
    let newName = prompt("Enter new Name:", currentUser.name);
    if (newName && newName.trim() !== "" && newName !== currentUser.name) {
        try {
            await apiCall('UPDATE_PROFILE', { phone: currentUser.phone, name: newName.trim() });
            currentUser.name = newName.trim(); updateProfileDashboardUI(); updateUI(); showToast("Name Updated Successfully!");
        } catch(e) { showToast("Failed to update name."); }
    }
}

async function saveBotAlertSettingsFS() {
    let isEnabled = document.getElementById('toggle-bot-alert-check-fs').checked; let newTgId = document.getElementById('bot-alert-tg-id-fs').value.trim();
    if (newTgId && !/^\d+$/.test(newTgId)) { return showToast("Telegram User ID must be NUMERIC only (no @)."); }
    try {
        await apiCall('UPDATE_PROFILE', { phone: currentUser.phone, botAlerts: isEnabled, tgUserId: newTgId });
        currentUser.botAlerts = isEnabled; currentUser.tgUserId = newTgId; updateProfileDashboardUI(); showToast("Bot Alert Settings Saved!"); showView('home');
    } catch(e) { showToast("Failed to save settings."); }
}

function updateProfileDashboardUI() {
    if(!currentUser) return;
    const pName = document.getElementById('profile-display-name'), pLblName = document.getElementById('profile-lbl-name'), pLblPhone = document.getElementById('profile-lbl-phone'), pLblCustom = document.getElementById('profile-lbl-custom'), pLblTg = document.getElementById('profile-lbl-tg'), pLblPin = document.getElementById('profile-lbl-pin'), pImg = document.getElementById('profile-dashboard-dp'), pInitial = document.getElementById('profile-dashboard-initial');

    if (pName) pName.innerHTML = currentUser.name;
    if (pLblName) pLblName.innerText = currentUser.name;
    if (pLblPhone) pLblPhone.innerText = currentUser.phone;
    if (pLblPin) pLblPin.innerText = currentUser.pin || "*XX*";
    
    if (pLblCustom) {
        if (currentUser.customId) { pLblCustom.innerText = currentUser.customId; pLblCustom.className = "font-black text-sm text-blue-500 font-mono"; } 
        else { pLblCustom.innerText = "id not configured"; pLblCustom.className = "font-bold text-sm text-gray-400 italic"; }
    }

    if (pLblTg) {
        if (currentUser.tgUserId) { pLblTg.innerText = currentUser.tgUserId; pLblTg.className = "font-bold text-sm text-blue-500 font-mono"; } 
        else { pLblTg.innerText = "Not Linked"; pLblTg.className = "font-medium text-sm text-gray-400 italic"; }
    }

    if (currentUser.dp) {
        if (pImg) { pImg.src = currentUser.dp; pImg.classList.remove('hidden'); }
        if (pInitial) pInitial.classList.add('hidden');
    } else {
        if (pImg) pImg.classList.add('hidden');
        if (pInitial) { pInitial.innerText = currentUser.name.charAt(0).toUpperCase(); pInitial.classList.remove('hidden'); }
    }
}

async function processLocalDpUpload(event) {
    const file = event.target.files[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) return showToast("Image size must be less than 2MB");
    showToast("Uploading Image..."); const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); const maxDim = 250;
            let width = img.width; let height = img.height;
            if (width > height) { if (width > maxDim) { height *= maxDim / width; width = maxDim; } } else { if (height > maxDim) { width *= maxDim / height; height = maxDim; } }
            canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
            const base64Data = canvas.toDataURL('image/jpeg', 0.7);
            apiCall('UPDATE_DP', { phone: currentUser?.phone, dp: base64Data }).then(() => { if(currentUser) currentUser.dp = base64Data; updateUI(); updateProfileDashboardUI(); showToast("Profile picture updated!"); }).catch(() => { showToast("Failed to upload Profile Picture."); });
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function handleScreenshotUpload(event) {
    const file = event.target.files[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) return showToast("Image size must be less than 2MB");
    showToast("Processing screenshot..."); const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); const maxDim = 320;
            let width = img.width; let height = img.height;
            if (width > height) { if (width > maxDim) { height *= maxDim / width; width = maxDim; } } else { if (height > maxDim) { width *= maxDim / height; height = maxDim; } }
            canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
            
            uploadedScreenshotBase64 = canvas.toDataURL('image/jpeg', 0.6);
            const btn = document.getElementById('btn-upload-screenshot');
            if (btn) { btn.innerHTML = `<i class="fas fa-exchange-alt"></i> Change Screenshot`; btn.classList.add('bg-green-50', 'text-green-600', 'border-green-300'); }
            const previewContainer = document.getElementById('screenshot-preview-container'); const previewImg = document.getElementById('screenshot-preview-img');
            if (previewContainer && previewImg) { previewImg.src = uploadedScreenshotBase64; previewContainer.classList.remove('hidden'); }
            showToast("Screenshot successfully uploaded!");
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// 1 Second Splash Screen Timing
async function handleSplashScreen() {
    return new Promise(resolve => {
        setTimeout(() => {
            const splash = document.getElementById('splash-screen');
            if(splash) { 
                splash.classList.add('opacity-0'); 
                setTimeout(() => { splash.classList.add('hidden'); resolve(); }, 300); 
            } 
            else { resolve(); }
        }, 700); 
    });
}

function initApp() {
    if(currentUser) {
        if(document.getElementById('ui-user-name')) document.getElementById('ui-user-name').innerText = currentUser.name; 
        if(document.getElementById('ui-card-phone')) document.getElementById('ui-card-phone').innerText = maskPhone(currentUser.phone);
        if(document.getElementById('ui-card-email')) document.getElementById('ui-card-email').innerText = maskEmail(currentUser.email || 'N/A');
        if(document.getElementById('ui-card-date')) document.getElementById('ui-card-date').innerText = currentUser.memberSince || 'N/A';

        if(document.getElementById('sidebar-name')) document.getElementById('sidebar-name').innerText = currentUser.name; 
        if(document.getElementById('sidebar-phone')) document.getElementById('sidebar-phone').innerText = currentUser.customId || currentUser.phone;
        if(document.getElementById('sidebar-qr')) document.getElementById('sidebar-qr').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=NGSOLUTION:${currentUser.phone}:${encodeURIComponent(currentUser.name)}`;
    }
    updateApiKeyUI(); updateProfileDashboardUI(); syncLoop(); 
    
    const urlParams = new URLSearchParams(window.location.search); const lifafaCode = urlParams.get('lifafa'); const refPhone = urlParams.get('ref');
    if(lifafaCode) { if(refPhone) lifafaReferrerPhone = refPhone; setTimeout(() => showPublicLifafa(lifafaCode), 1000); window.history.replaceState({}, document.title, "/"); }
}

// Receive Modal logic with QR generation
function openReceiveModal() {
    if (currentUser) {
        let qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=NGSOLUTION:${currentUser.phone}:${encodeURIComponent(currentUser.name)}`;
        let receiveImg = document.getElementById('receive-qr-img');
        if (receiveImg) receiveImg.src = qrUrl;
        
        let receiveNum = document.getElementById('receive-num-display');
        if (receiveNum) receiveNum.innerText = currentUser.phone;
    }
    document.getElementById('actionModalReceive').classList.remove('hidden');
    setTimeout(() => document.getElementById('actionModalReceive').classList.remove('opacity-0'), 10);
}

function showActionSuccess(data) {
    return new Promise(resolve => {
        const rocketOverlay = document.getElementById('rocket-overlay'); const rocketWrapper = document.getElementById('rocket-wrapper'); const resultOverlay = document.getElementById('txn-result-overlay');
        if(rocketOverlay) {
            rocketOverlay.classList.remove('hidden'); requestAnimationFrame(() => rocketWrapper.classList.add('animate-rocket-fly-slow'));
            setTimeout(() => { rocketOverlay.classList.add('hidden'); rocketWrapper.classList.remove('animate-rocket-fly-slow'); showResultBox(data, true, resultOverlay, resolve); }, 2000); 
        } else { showResultBox(data, true, resultOverlay, resolve); }
    });
}

function showActionError(data) {
    return new Promise(resolve => {
        const resultOverlay = document.getElementById('txn-result-overlay'); showResultBox(data, false, resultOverlay, resolve);
    });
}

function showResultBox(data, isSuccess, resultOverlay, resolve) {
    if(!resultOverlay) return resolve();
    let bgIcon = document.getElementById('txn-result-icon-bg'), icon = document.getElementById('txn-result-icon'), title = document.getElementById('txn-result-title'), errorBox = document.getElementById('txn-result-error-box');

    if(isSuccess) {
        bgIcon.className = "w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner animate-[slideDown_0.5s_ease-out] bg-green-100 text-green-500 border border-green-200";
        icon.className = "fas fa-check"; title.innerText = 'Payment Successful'; title.className = "text-xl font-bold text-gray-800 mb-2 tracking-wide animate-[slideUpFade_0.5s_ease-out_0.1s] opacity-0";
        if(errorBox) errorBox.classList.add('hidden');
    } else {
        bgIcon.className = "w-20 h-20 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner animate-[slideDown_0.5s_ease-out] bg-red-100 text-red-500 border border-red-200";
        icon.className = "fas fa-times animate-shake"; title.innerText = 'Payment Failed'; title.className = "text-xl font-bold text-red-600 mb-2 tracking-wide animate-[slideUpFade_0.5s_ease-out_0.1s] opacity-0";
        if(errorBox) { errorBox.classList.remove('hidden'); document.getElementById('txn-result-error-reason').innerText = data.message || "Something went wrong."; }
    }

    document.getElementById('txn-result-amount').innerText = parseFloat(data.amount || 0).toFixed(2);
    
    const dpImg = document.getElementById('txn-result-dp'), dpInitial = document.getElementById('txn-result-initial');
    if(data.dp && isSuccess) { dpImg.src = data.dp; dpImg.classList.remove('hidden'); dpInitial.classList.add('hidden'); } 
    else { dpImg.classList.add('hidden'); dpInitial.classList.remove('hidden'); dpInitial.innerText = data.name ? data.name.charAt(0).toUpperCase() : (isSuccess ? 'U' : 'X'); }

    document.getElementById('txn-result-name').innerText = data.name || 'User'; document.getElementById('txn-result-desc').innerText = data.detail || 'Details';
    document.getElementById('txn-result-id').innerText = data.txnId || (isSuccess ? generateTxnId() : 'FAILED-' + Date.now().toString(36).toUpperCase());
    document.getElementById('txn-result-date').innerText = formatDateTime();
    resultOverlay.classList.remove('hidden'); resultOverlay.style.display = 'flex'; resolve();
}

function closeSuccessOverlay() { document.getElementById('txn-result-overlay').classList.add('hidden'); showView('home'); }

async function processSend() {
    if(!checkCooldown()) return;
    let pin = document.getElementById('send-pin').value; if(!checkSecurityPin(pin)) return;
    if (!sendResolvedPhone) return showActionError({ amount: 0, name: "Unknown", detail: "N/A", message: "Invalid Receiver or Not Found!"});
    if (sendResolvedPhone === currentUser?.phone) return showActionError({ amount: 0, name: "Self", detail: sendResolvedPhone, message: "Cannot send to yourself!"});
    let amt = parseFloat(document.getElementById('send-amt').value); let comment = document.getElementById('send-comment').value.trim();
    
    if(isNaN(amt) || amt <= 0) return showActionError({ amount: amt, name: "Invalid Amount", message: "Enter a valid amount."});
    if(amt > currentBalance) return showActionError({ amount: amt, name: document.getElementById('send-name').innerText, detail: sendResolvedPhone, message: "Insufficient Wallet Balance!"});

    try {
        let receiver = await apiCall('CHECK_USER', { phone: sendResolvedPhone }); 
        if (!receiver) return showActionError({ amount: amt, detail: sendResolvedPhone, message: "Receiver not found!" });
        let name = receiver.name || 'Unknown User'; 

        let txn = createTxnObj('out', 'Sent to ' + name, amt, 'Success', 'fa-paper-plane', 'blue', name, sendResolvedPhone); txn.comment = comment;
        await apiCall('EXECUTE_TXN', { mode: 'SEND', sender: currentUser?.phone, receiver: sendResolvedPhone, amount: amt, txn });
        playSound('debit'); sendTelegramMsg(currentUser?.tgUserId, formatTgMsg('out', 'Payment Sent to ' + name, amt, `TXN: ${txn.id}`)); 
        document.getElementById('form-send').reset(); currentBalance -= amt; updateUI(); 
        showActionSuccess({ type: 'transfer', dp: receiver.dp, name: name, detail: sendResolvedPhone, amount: amt, txnId: txn.id });
    } catch(e) { showActionError({ amount: amt, detail: sendResolvedPhone, message: e.message || "Payment processing failed." }); }
}

async function processScanPay() {
    if(!checkCooldown()) return;
    let pin = document.getElementById('scan-pin').value; if(!checkSecurityPin(pin)) return;
    let receiverNum = document.getElementById('scan-res-phone').innerText;
    if (!receiverNum) return showActionError({ amount: 0, name: "Unknown", message: "Invalid Receiver from Scan!"});
    if (receiverNum === currentUser?.phone) return showActionError({ amount: 0, name: "Self", message: "Cannot send to yourself!"});
    let amt = parseFloat(document.getElementById('scan-amt').value); let comment = document.getElementById('scan-comment').value.trim();
    
    if(isNaN(amt) || amt <= 0) return showActionError({ amount: amt, name: "Invalid", message: "Enter a valid amount."});
    if(amt > currentBalance) return showActionError({ amount: amt, name: document.getElementById('scan-res-name').innerText, detail: receiverNum, message: "Insufficient Wallet Balance!"});

    try {
        let receiver = await apiCall('CHECK_USER', { phone: receiverNum }); 
        if (!receiver) return showActionError({ amount: amt, detail: receiverNum, message: "Receiver not found!" });
        let name = receiver.name || 'Unknown User'; 

        let txn = createTxnObj('out', 'Scanned & Sent to ' + name, amt, 'Success', 'fa-qrcode', 'blue', name, receiverNum); txn.comment = comment;
        await apiCall('EXECUTE_TXN', { mode: 'SEND', sender: currentUser?.phone, receiver: receiverNum, amount: amt, txn });
        playSound('debit'); sendTelegramMsg(currentUser?.tgUserId, formatTgMsg('out', 'Scanned Payment Sent to ' + name, amt, `TXN: ${txn.id}`)); 
        document.getElementById('scan-amt').value = ''; document.getElementById('scan-pin').value = ''; document.getElementById('scan-comment').value = ''; currentBalance -= amt; updateUI(); 
        document.getElementById('scan-result').classList.add('hidden');
        showActionSuccess({ type: 'transfer', dp: receiver.dp, name: name, detail: receiverNum, amount: amt, txnId: txn.id });
    } catch(e) { showActionError({ amount: amt, detail: receiverNum, message: e.message || "Payment processing failed." }); }
}

async function processAdd() {
    if(!checkCooldown()) return;
    let utr = document.getElementById('add-utr').value.trim(); let amt = parseFloat(document.getElementById('add-amt').value);
    
    if(isNaN(amt) || amt <= 0) return showActionError({ amount: amt, name: "Deposit Failed", message: "Invalid amount!"});
    if (!utr) return showActionError({ amount: amt, name: "Deposit Failed", message: "UTR number is required!"});
    if (!uploadedScreenshotBase64) return showActionError({ amount: amt, name: "Deposit Failed", message: "Please upload a payment screenshot!"});
    
    try {
        let txn = createTxnObj('in', 'Deposit via UTR', amt, 'Pending', 'fa-clock', 'yellow', 'Self Deposit', utr); txn.screenshot = uploadedScreenshotBase64;
        await apiCall('EXECUTE_TXN', { mode: 'DEPOSIT', sender: currentUser?.phone, txn });
        let adminChatId = globalSettings.adminChatId || null; let depositMsg = `🔔 <b>NG SOLUTION DEPOSIT REQ</b>\nUser: ${currentUser?.name}\nAmount: ₹${amt}\nUTR: ${utr}\nTXN: ${txn.id}`;
        if (adminChatId) sendTelegramMsg(adminChatId, depositMsg, false);
        playSound('success');
        document.getElementById('add-utr').value = ''; document.getElementById('add-amt').value = ''; uploadedScreenshotBase64 = null;
        const btn = document.getElementById('btn-upload-screenshot');
        if (btn) { btn.innerHTML = `<i class="fas fa-image"></i> Upload Screenshot`; btn.className = "w-full mb-4 py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors shadow-sm"; }
        document.getElementById('screenshot-preview-container').classList.add('hidden');
        showActionSuccess({ type: 'add', name: "Deposit Request Sent", detail: `UTR: ${utr}`, amount: amt, txnId: txn.id });
    } catch (e) { showActionError({ amount: amt, detail: utr, message: e.message || "Deposit request failed." }); }
}

async function processBulk() {
    if(!checkCooldown()) return;
    let pin = document.getElementById('bulk-pin').value; if(!checkSecurityPin(pin)) return;
    let numsText = document.getElementById('bulk-nums').value.trim(); let amt = parseFloat(document.getElementById('bulk-amt').value); let comment = document.getElementById('bulk-comment').value.trim();
    
    if(isNaN(amt) || amt <= 0) return showActionError({ amount: amt, name: "Bulk Transfer", message: "Invalid amount!"});
    if(!numsText) return showActionError({ amount: amt, name: "Bulk Transfer", message: "Receivers list cannot be empty!"});
    
    let rawLines = numsText.split('\n').filter(n => n.trim() !== ''); let resolvedReceivers = [];
    for (let r of rawLines) { try { let userCheck = await apiCall('CHECK_USER', { phone: r }); if (userCheck && userCheck.resolvedPhone && userCheck.resolvedPhone !== currentUser?.phone) { resolvedReceivers.push(userCheck.resolvedPhone); } } catch(e) {} }
    if (resolvedReceivers.length === 0) return showActionError({ amount: amt, name: "Bulk Transfer", message: "No valid registered receivers found."});
    
    let totalAmt = resolvedReceivers.length * amt; 
    if(totalAmt > currentBalance) return showActionError({ amount: totalAmt, name: "Bulk Transfer", message: `Need ₹${totalAmt} for ${resolvedReceivers.length} users. Insufficient balance.`});
    
    try {
        await apiCall('BULK_PAY', { sender: currentUser?.phone, receivers: resolvedReceivers, amount: amt, comment: comment, date: formatDateTime() });
        playSound('debit'); sendTelegramMsg(currentUser?.tgUserId, formatTgMsg('out', `Bulk Sent to ${resolvedReceivers.length} users`, totalAmt, `Done!`)); 
        currentBalance -= totalAmt; updateUI();
        document.getElementById('bulk-nums').value = ''; document.getElementById('bulk-amt').value = ''; document.getElementById('bulk-pin').value = ''; document.getElementById('bulk-comment').value = ''; 
        showActionSuccess({ type: 'bulk', name: `Bulk Transfer`, detail: `${resolvedReceivers.length} Total Users Successfully Sent`, amount: totalAmt, txnId: generateTxnId() });
    } catch(e) { showActionError({ amount: totalAmt, name: "Bulk Transfer", message: e.message || "Bulk transfer failed." }); }
}

async function processWithdraw() {
    if(!checkCooldown()) return;
    let pin = document.getElementById('with-pin').value; if(!checkSecurityPin(pin)) return;
    let upi = document.getElementById('with-upi').value; let amt = parseFloat(document.getElementById('with-amt').value);
    
    if(isNaN(amt) || amt <= 0) return showActionError({ amount: amt, name: "Withdraw Request", message: "Invalid amount!"});
    if(amt < 10) return showActionError({ amount: amt, name: "Withdraw Request", message: "Minimum withdrawal is ₹10"}); 
    if(amt > currentBalance) return showActionError({ amount: amt, name: "Withdraw Request", message: "Insufficient Balance!"});
    
    try {
        let txn = createTxnObj('out', 'Withdrawal Request', amt, 'Pending', 'fa-university', 'blue', 'Bank Withdraw', upi);
        await apiCall('EXECUTE_TXN', { mode: 'WITHDRAW', sender: currentUser?.phone, amount: amt, txn: txn });
        
        let adminChatId = globalSettings.adminChatId || null; 
        let withdrawMsg = `📤 <b>NG SOLUTION WITHDRAWAL</b>\n\n👤 User: <b>${currentUser?.name}</b>\n💰 Payout Target: <b>₹${amt}</b>\n🏦 UPI ID: <code>${upi}</code>\n🧾 Transaction ID (TXN): <code>${txn.id}</code>\n\n🔹 Please process this withdrawal request.`;
        if (adminChatId) sendTelegramMsg(adminChatId, withdrawMsg, false);
        
        playSound('debit'); currentBalance -= amt; updateUI(); 
        document.getElementById('with-upi').value = ''; document.getElementById('with-amt').value = ''; document.getElementById('with-pin').value = ''; 
        showActionSuccess({ type: 'withdraw', name: "Withdraw Request Sent", detail: `UPI: ${upi}`, amount: amt, txnId: txn.id });
    } catch(e) { showActionError({ amount: amt, name: "Withdraw Request", message: e.message || "Withdrawal request failed." }); }
}

// ----------------------------------------------------
// VAULT (KEEPER) LOGIC RESTORED
// ----------------------------------------------------
async function processKeeperLock() {
    if(!checkCooldown()) return;
    let pin = document.getElementById('kl-pin').value; if(!checkSecurityPin(pin)) return;
    let amt = parseFloat(document.getElementById('kl-amt').value); 
    if(isNaN(amt) || amt <= 0) return showToast("Invalid amount!");
    if(amt > currentBalance) return showToast("Insufficient Wallet Balance!");
    let txn = createTxnObj('out', 'Locked in Vault', amt, 'Success', 'fa-lock', 'blue', 'Self Vault', 'N/A');
    await apiCall('EXECUTE_TXN', { mode: 'KEEPER_LOCK', sender: currentUser?.phone, amount: amt, txn });
    playSound('debit');
    currentBalance -= amt; keeperBalance += amt; updateUI(); 
    document.getElementById('kl-amt').value = ''; document.getElementById('kl-pin').value = ''; 
    showToast(`₹${amt} safely locked!`);
}

async function processKeeperWithdraw() {
    if(!checkCooldown()) return;
    let pin = document.getElementById('kw-pin').value; if(!checkSecurityPin(pin)) return;
    let amt = parseFloat(document.getElementById('kw-amt').value); 
    if(isNaN(amt) || amt <= 0) return showToast("Invalid amount!");
    if(amt > keeperBalance) return showToast("Insufficient Vault Balance!");
    let txn = createTxnObj('in', 'Withdrawn from Vault', amt, 'Success', 'fa-unlock', 'green', 'Self Vault', 'N/A');
    await apiCall('EXECUTE_TXN', { mode: 'KEEPER_WITHDRAW', sender: currentUser?.phone, amount: Number(amt), txn });
    playSound('credit');
    keeperBalance -= amt; currentBalance += amt; updateUI(); 
    document.getElementById('kw-amt').value = ''; document.getElementById('kw-pin').value = ''; 
    showToast(`₹${amt} moved to Wallet!`);
}

// ----------------------------------------------------
// ADVANCED LIFAFA SYSTEM
// ----------------------------------------------------
function toggleLifafaTypeUI() {
    let type = document.getElementById('lif-type').value;
    if(type === 'standard' || type === 'coin') { document.getElementById('lif-amt-standard-wrapper').classList.remove('hidden'); document.getElementById('lif-amt-random-wrapper').classList.add('hidden'); } 
    else { document.getElementById('lif-amt-standard-wrapper').classList.add('hidden'); document.getElementById('lif-amt-random-wrapper').classList.remove('hidden'); }
}
function addLifafaChannelInput() {
    let container = document.getElementById('lif-channels-container'); if(container.children.length >= 20) return showToast("Maximum 20 channels allowed.");
    let div = document.createElement('div'); div.className = "flex items-center gap-2 mt-2";
    div.innerHTML = `<input type="text" class="lif-channel-input w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus-accent theme-card font-mono" placeholder="e.g. @yourchannel"><button type="button" onclick="removeLifafaChannelInput(this)" class="text-red-500 p-2"><i class="fas fa-trash"></i></button>`;
    container.appendChild(div);
}
function removeLifafaChannelInput(btn) { btn.parentElement.remove(); }
function resetLifafaCreationForm() {
    document.getElementById('lifafa-success-box').classList.add('hidden'); document.getElementById('lifafa-create-form-wrapper').classList.remove('hidden');
    document.getElementById('lif-amt').value=''; document.getElementById('lif-min-amt').value=''; document.getElementById('lif-max-amt').value=''; document.getElementById('lif-users').value=''; 
    if(document.getElementById('lif-refer-amt')) document.getElementById('lif-refer-amt').value='';
    document.getElementById('lif-pin').value=''; document.getElementById('lif-password').value='';
    document.getElementById('lif-channels-container').innerHTML = '<div class="flex items-center gap-2"><input type="text" class="lif-channel-input w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus-accent theme-card font-mono" placeholder="e.g. @yourchannel"><button type="button" onclick="removeLifafaChannelInput(this)" class="text-red-500 p-2"><i class="fas fa-trash"></i></button></div>';
}

async function processLifafaCreate() {
    if(!checkCooldown()) return; let pin = document.getElementById('lif-pin').value; if(!checkSecurityPin(pin)) return;
    let type = document.getElementById('lif-type').value; let users = parseInt(document.getElementById('lif-users').value); 
    if (isNaN(users) || users <= 0) return showActionError({ amount: 0, name: "Lifafa", message: "Invalid users limit!"});
    
    let amountPerUser = 0, minAmount = 0, maxAmount = 0;
    if(type === 'standard' || type === 'coin') { amountPerUser = parseFloat(document.getElementById('lif-amt').value); if(isNaN(amountPerUser) || amountPerUser <= 0) return showActionError({ amount: amountPerUser, name: "Lifafa", message: "Invalid amount!"}); } 
    else { minAmount = parseFloat(document.getElementById('lif-min-amt').value); maxAmount = parseFloat(document.getElementById('lif-max-amt').value); if(isNaN(minAmount) || isNaN(maxAmount) || minAmount <= 0 || maxAmount < minAmount) return showActionError({ amount: 0, name: "Lifafa", message: "Invalid min/max amounts!"}); }
    
    let referActive = document.getElementById('lif-refer-toggle') && document.getElementById('lif-refer-toggle').checked; let referAmount = 0;
    if(referActive) { referAmount = parseFloat(document.getElementById('lif-refer-amt').value); if(isNaN(referAmount) || referAmount <= 0) return showActionError({ amount: referAmount, name: "Lifafa", message: "Invalid refer amount!"}); }
    let password = document.getElementById('lif-password').value.trim(); let channelInputs = document.querySelectorAll('.lif-channel-input'); let channels = []; channelInputs.forEach(input => { if(input.value.trim()) channels.push(input.value.trim()); });
    
    let maxBaseDeduction = 0;
    if(type === 'standard') maxBaseDeduction = amountPerUser * users; else if(type === 'coin') maxBaseDeduction = (amountPerUser * 2) * users; else if(type === 'scratch') maxBaseDeduction = maxAmount * users;

    let totalReferDeduction = referActive ? (referAmount * users) : 0; let totalDeduction = maxBaseDeduction + totalReferDeduction;
    if(totalDeduction > currentBalance) return showActionError({ amount: totalDeduction, name: "Lifafa", message: "Insufficient Balance!"});

    let txn = createTxnObj('out', `Lifafa Created`, totalDeduction, `Success`, 'fa-envelope-open-text', 'blue', 'Lifafa System', 'N/A');
    try {
        let lifafaId = await apiCall('CREATE_LIFAFA', { phone: currentUser?.phone, type: type, amountPerUser: amountPerUser, minAmount: minAmount, maxAmount: maxAmount, totalUsers: users, password: password, channels: channels, referActive: referActive, referAmount: referAmount, totalDeduction: totalDeduction, txn });
        playSound('debit'); currentBalance -= totalDeduction; updateUI(); 
        let finalLink = `https://${window.location.host}/?lifafa=${lifafaId}`;
        document.getElementById('lifafa-create-form-wrapper').classList.add('hidden'); document.getElementById('lifafa-result-link').value = finalLink; document.getElementById('lifafa-success-box').classList.remove('hidden');
    } catch(e) { showActionError({ amount: totalDeduction, name: "Lifafa", message: e.message || "Failed to create Lifafa." }); }
}

async function renderMyLifafas() {
    let container = document.getElementById('my-lifafa-list'); container.innerHTML = '<p class="text-center text-gray-400 text-xs py-4 font-bold"><i class="fas fa-spinner fa-spin mr-2"></i>Loading History...</p>';
    try {
        let res = await fetch(`https://ng-solutions-1c68b-default-rtdb.firebaseio.com/lifafas.json?orderBy="createdBy"&equalTo="${currentUser.phone}"`);
        let data = await res.json(); container.innerHTML = '';
        if(!data || Object.keys(data).length === 0 || data.error) { container.innerHTML = '<p class="text-center text-gray-400 text-xs py-4 font-bold">No Lifafas created yet.</p>'; return; }
        
        let lifafas = Object.values(data).sort((a,b) => b.timestamp - a.timestamp);
        lifafas.forEach(l => {
            let claimed = l.totalUsers - l.remainingUsers; let link = `https://${window.location.host}/?lifafa=${l.id}`;
            let passText = l.hasPassword ? `<i class="fas fa-lock text-blue-500"></i> ${l.password}` : `<i class="fas fa-unlock text-green-500"></i> No Pass`;
            let amtStr = l.type === 'standard' ? `₹${l.amountPerUser} (Fixed)` : (l.type === 'coin' ? `₹${l.amountPerUser * 2} (Coin)` : `₹${l.minAmount}-₹${l.maxAmount} (Scratch)`);
            let typeIcon = l.type === 'scratch' ? 'fa-ticket-alt' : (l.type === 'coin' ? 'fa-coins' : 'fa-envelope');
            container.innerHTML += `
            <div class="theme-card p-4 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden transition-all hover:bg-gray-50">
                <div class="flex justify-between items-start mb-2"><div class="flex gap-3"><div class="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center text-lg"><i class="fas ${typeIcon}"></i></div><div><p class="text-sm font-black accent-text uppercase tracking-wide">${amtStr}</p><p class="text-[10px] font-bold text-gray-400 mt-0.5">${new Date(l.timestamp).toLocaleString('en-IN')}</p></div></div><div class="text-right"><p class="text-sm font-black text-gray-800">${claimed} / ${l.totalUsers}</p><p class="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Claimed</p></div></div>
                <div class="flex justify-between items-center bg-gray-50 p-3 rounded-xl mt-3 border border-gray-200"><span class="text-xs font-mono font-bold text-gray-500 truncate w-24">${l.id}</span><div class="flex gap-2"><span class="text-[10px] font-black px-2 py-1 bg-white rounded-md shadow-sm border border-gray-100 flex items-center gap-1">${passText}</span><button onclick="copyText('${link}')" class="text-blue-500 hover:text-blue-600 px-3 py-1 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"><i class="fas fa-copy"></i></button></div></div>
            </div>`;
        });
    } catch(e) { container.innerHTML = '<p class="text-center text-red-500 text-xs py-4">Error loading history.</p>'; }
}

async function showPublicLifafa(code) {
    currentLifafaId = code; document.getElementById('public-lifafa-wrapper').classList.remove('hidden'); document.getElementById('public-lifafa-wrapper').style.display = 'flex';
    document.getElementById('lif-public-step-1').classList.remove('hidden'); document.getElementById('lif-public-step-2').classList.add('hidden'); document.getElementById('lif-public-step-3').classList.add('hidden'); document.getElementById('lif-public-refer-step').classList.add('hidden'); document.getElementById('lif-public-result').classList.add('hidden');
    if(currentUser) { document.getElementById('public-lif-phone').value = currentUser.phone; verifyLifafaUser(); }
}

async function verifyLifafaUser() {
    let input = document.getElementById('public-lif-phone').value.trim(); if(!input) return showToast("Enter your Phone or ID");
    let btn = document.querySelector('#lif-public-step-1 button'); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
    try {
        let user = await apiCall('CHECK_USER', { phone: input }); if(!user) throw new Error("User not found!");
        lifafaClaimerPhone = user.resolvedPhone; lifafaClaimerTgId = user.tgUserId;
        let details = await apiCall('GET_LIFAFA_DETAILS', { lifafaId: currentLifafaId, phone: lifafaClaimerPhone }); currentLifafaDetails = details;
        if (details.alreadyClaimed) {
            if (details.referActive) { document.getElementById('lif-public-step-1').classList.add('hidden'); document.getElementById('lif-public-refer-step').classList.remove('hidden'); document.getElementById('public-lif-refer-link').value = `https://${window.location.host}/?lifafa=${currentLifafaId}&ref=${lifafaClaimerPhone}`; return; } 
            else { window.location.href = `https://${window.location.host}`; return; }
        }
        if (details.remainingUsers <= 0) throw new Error("Lifafa is fully claimed or empty!");
        document.getElementById('lif-public-step-1').classList.add('hidden');
        if (details.channels && details.channels.length > 0) {
            let grid = document.getElementById('public-channels-grid'); grid.innerHTML = '';
            details.channels.forEach(ch => { let chLink = ch.startsWith('@') ? `https://t.me/${ch.substring(1)}` : ch; grid.innerHTML += `<a href="${chLink}" target="_blank" class="channel-box bg-blue-50 border border-blue-200 text-blue-600 font-black text-xs py-4 px-2 rounded-xl text-center shadow-sm flex flex-col items-center justify-center"><i class="fab fa-telegram-plane mb-2 text-2xl"></i><span class="truncate w-full block">${ch}</span></a>`; });
            document.getElementById('lif-public-step-2').classList.remove('hidden');
        } else { prepareLifafaStep3(); }
    } catch(e) { showToast(e.message); } finally { btn.innerHTML = 'NEXT <i class="fas fa-arrow-right ml-1"></i>'; }
}

async function verifyLifafaChannelsJoined() {
    if (!lifafaClaimerTgId) return showToast("Telegram ID must be linked!");
    let btn = document.getElementById('btn-lif-verify-channels'); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
    try {
        await apiCall('VERIFY_LIFAFA_CHANNELS', { lifafaId: currentLifafaId, tgUserId: lifafaClaimerTgId });
        let ring = document.createElement('div'); ring.className = 'lifafa-success-ring'; document.querySelector('.lifafa-float').appendChild(ring); setTimeout(() => ring.remove(), 600);
        playSound('success'); document.getElementById('lif-public-step-2').classList.add('hidden'); prepareLifafaStep3();
    } catch(e) { showToast(e.message); } finally { btn.innerHTML = '<i class="fas fa-sync-alt"></i> CHECK MEMBERSHIP'; }
}

function prepareLifafaStep3() { document.getElementById('lif-public-step-3').classList.remove('hidden'); if (currentLifafaDetails.hasPassword) { document.getElementById('public-lif-password-box').classList.remove('hidden'); } else { document.getElementById('public-lif-password-box').classList.add('hidden'); } }

async function executePublicLifafaClaim() {
    let pass = ''; if (currentLifafaDetails.hasPassword) { pass = document.getElementById('public-lif-password').value.trim(); if(!pass) return showToast("Access Code is required!"); }
    let txn = createTxnObj('in', `Claimed Lifafa`, 0, `Success`, 'fa-envelope-open-text', 'green', 'Lifafa Reward', 'N/A');
    try {
        let res = await apiCall('CLAIM_LIFAFA', { phone: lifafaClaimerPhone, referrerPhone: lifafaReferrerPhone, lifafaId: currentLifafaId, password: pass, txn });
        playSound('credit');
        if (currentUser && currentUser.phone === lifafaClaimerPhone) { currentBalance += res.amount; updateUI(); }
        document.getElementById('lif-public-step-3').classList.add('hidden'); renderLifafaResult(res);
        sendTelegramMsg(lifafaClaimerTgId, `🎉 <b>Lifafa Claimed!</b>\n💰 Reward: ₹${res.amount}\n✅ Added to your wallet!`);
    } catch(e) { showToast(e.message); }
}

function renderLifafaResult(data) {
    let resBox = document.getElementById('lif-public-result'); resBox.innerHTML = ''; resBox.classList.remove('hidden');
    let animHtml = '';
    if(data.type === 'scratch') animHtml = `<div class="w-32 h-32 mx-auto bg-gray-200 rounded-xl overflow-hidden relative anim-scratch-reveal mb-4 border-2 border-gray-300 shadow-inner"><div class="absolute inset-0 bg-gradient-to-br from-blue-300 to-blue-500 flex flex-col items-center justify-center font-black text-3xl text-white shadow-xl"><span class="text-[10px] uppercase tracking-widest text-blue-100 mb-1">You Won</span>₹${data.amount}</div></div>`;
    else if (data.type === 'coin') { let coinClass = data.amount > 0 ? 'bg-gradient-to-br from-blue-400 to-blue-600 text-white' : 'bg-gradient-to-br from-gray-200 to-gray-400 text-gray-600'; let coinText = data.amount > 0 ? `₹${data.amount}` : `0`; let coinTitle = data.amount > 0 ? 'You Won!' : 'Bad Luck!'; animHtml = `<div class="w-32 h-32 mx-auto rounded-full ${coinClass} flex flex-col items-center justify-center font-black text-3xl anim-coin-flip mb-4 border-4 border-white shadow-2xl"><span class="text-[10px] uppercase tracking-widest mb-1 opacity-80">${coinTitle}</span>${coinText}</div>`; } 
    else { animHtml = `<div class="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center text-4xl mx-auto mb-4 shadow-inner border border-green-200"><i class="fas fa-check"></i></div><div class="text-5xl text-green-500 mb-6 font-black tracking-tight">₹${data.amount}</div>`; }

    let referHtml = '';
    if (data.referActive) { let referLink = `https://${window.location.host}/?lifafa=${currentLifafaId}&ref=${lifafaClaimerPhone}`; referHtml = `<div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-2xl"><p class="text-xs font-black text-blue-700 mb-2 uppercase tracking-wide"><i class="fas fa-share-alt mr-1"></i> Refer & Earn</p><p class="text-[10px] font-bold text-gray-500 mb-3 leading-relaxed">Share this link to earn bonus rewards when friends claim!</p><div class="relative"><input type="text" readonly value="${referLink}" class="w-full bg-white px-4 py-3 rounded-xl border border-blue-100 text-xs font-mono text-gray-600 pr-12 focus-accent theme-card"><button onclick="copyText('${referLink}')" class="absolute right-1 top-1 w-10 h-10 flex items-center justify-center bg-blue-500 text-white rounded-lg hover:bg-blue-600 shadow-sm"><i class="fas fa-copy"></i></button></div></div>`; }
    resBox.innerHTML = `<h2 class="text-2xl font-black mb-6 text-gray-800">Claim Successful!</h2>${animHtml}${referHtml}<button type="button" onclick="window.location.href='/'" class="w-full mt-6 btn-animate theme-card border border-gray-200 text-gray-600 font-black py-4 rounded-xl shadow-sm tracking-wide">GO TO DASHBOARD</button>`;
}

function resetPublicLifafa() {
    document.getElementById('public-lifafa-wrapper').classList.add('hidden');
    document.getElementById('lif-public-step-1').classList.remove('hidden'); document.getElementById('lif-public-step-2').classList.add('hidden'); document.getElementById('lif-public-step-3').classList.add('hidden'); document.getElementById('lif-public-refer-step').classList.add('hidden'); document.getElementById('lif-public-result').classList.add('hidden');
    document.getElementById('public-lif-phone').value = ''; document.getElementById('public-lif-password').value = ''; currentLifafaId = null; currentLifafaDetails = null; lifafaClaimerPhone = null; lifafaClaimerTgId = null; lifafaReferrerPhone = null;
}

// ----------------------------------------------------
// GIFT CODES SYSTEM
// ----------------------------------------------------
async function processGiftCreate() {
    if(!checkCooldown()) return; let pin = document.getElementById('gift-pin').value; if(!checkSecurityPin(pin)) return;
    let amt = parseFloat(document.getElementById('gift-amt').value); let users = parseInt(document.getElementById('gift-users').value); 
    if(isNaN(amt) || amt <= 0) return showActionError({ amount: amt, name: "Gift Code", message: "Invalid amount!"});
    let total = amt * users; if(total > currentBalance) return showActionError({ amount: total, name: "Gift Code", message: "Insufficient Wallet Balance!"});
    let code = Math.random().toString(36).substring(2, 7).toUpperCase();
    let txn = createTxnObj('out', `Gift Code Created`, total, `Code: ${code}`, 'fa-gift', 'blue', 'Gift System', 'N/A');
    try {
        await apiCall('CREATE_GIFT', { phone: currentUser?.phone, code, amount: amt, users, txn });
        playSound('debit'); sendTelegramMsg(currentUser?.tgUserId, formatTgMsg('out', 'Gift Code Generated', total, `Code: <b>${code}</b>`)); 
        currentBalance -= total; updateUI(); 
        document.getElementById('gift-amt').value=''; document.getElementById('gift-users').value=''; document.getElementById('gift-pin').value=''; 
        showActionSuccess({ type: 'gift', name: "Gift Code Active", detail: `Code: ${code} (${users} Users)`, amount: total, txnId: txn.id });
    } catch(e) { showActionError({ amount: total, name: "Gift Code", message: e.message || "Gift creation failed." }); }
}

async function processGiftClaim() {
    let code = document.getElementById('claim-code').value.toUpperCase(); 
    if(code.length !== 5) return showActionError({ amount: 0, name: "Gift Claim", message: "Invalid Code format. Must be 5 digits."});
    try {
        let txn = createTxnObj('in', `Claimed Gift Code`, 0, `Code: ${code}`, 'fa-gift', 'green', 'Gift Code', 'N/A'); 
        let reward = await apiCall('CLAIM_GIFT', { phone: currentUser?.phone, code, txn });
        playSound('credit'); sendTelegramMsg(currentUser?.tgUserId, formatTgMsg('in', 'Gift Claimed', reward, `Code: <b>${code}</b>`)); 
        document.getElementById('claim-code').value = ''; currentBalance += reward; updateUI(); 
        showActionSuccess({ type: 'gift-claim', name: "Gift Code Redeemed", detail: `Code: ${code}`, amount: reward, txnId: txn.id });
    } catch(e) { showActionError({ amount: 0, name: "Gift Claim", message: e.message || "Invalid code or already claimed." }); }
}

async function toggleTxnVisibility() {
    if (!currentModalTxnId) return;
    try {
        await apiCall('TOGGLE_TXN_VISIBILITY', { phone: currentUser?.phone, txnId: currentModalTxnId, isHidden: true });
        if (!currentUser.hiddenTxns) currentUser.hiddenTxns = {};
        currentUser.hiddenTxns[currentModalTxnId] = true;
        showToast("Transaction hidden from home!"); closeTxnModal(); updateUI();
    } catch(e) {}
}

let lastTxnSignature = ""; let deleteHistoryTapCount = 0; let deleteHistoryTimer;

function handleSecretDeleteHistoryTap() {
    deleteHistoryTapCount++; clearTimeout(deleteHistoryTimer); deleteHistoryTimer = setTimeout(() => { deleteHistoryTapCount = 0; }, 2000); 
    if (deleteHistoryTapCount >= 15) { deleteHistoryTapCount = 0; if (confirm("Confirm to delete all transactions history?")) { executeHistoryDeletion(); } }
}

async function executeHistoryDeletion() {
    try { showToast("Deleting transaction history..."); await apiCall('CLEAR_HISTORY', { phone: currentUser?.phone }); transactions = []; updateStatsDashboard(); updateUI(); showToast("Transaction history completely cleared!"); } catch(e) { showToast("Failed to delete history."); }
}

function updateStatsDashboard() {
    let totalCredit = 0; let totalDebit = 0; let successCount = 0; let totalTxns = transactions.length;
    transactions.forEach(t => {
        let amt = Number(t.amount) || 0;
        if (t.status === 'Success') { successCount++; if (t.type === 'in') totalCredit += amt; else if (t.type === 'out') totalDebit += amt; }
    });
    let successRate = totalTxns > 0 ? ((successCount / totalTxns) * 100).toFixed(1) + '%' : '100%';

    let profCred = document.getElementById('prof-stats-total-credit'); if(profCred) profCred.innerText = '₹' + totalCredit.toFixed(2);
    let profDeb = document.getElementById('prof-stats-total-debit'); if(profDeb) profDeb.innerText = '₹' + totalDebit.toFixed(2);
    let profNum = document.getElementById('prof-stats-no-of-txns'); if(profNum) profNum.innerText = totalTxns;
    let profRate = document.getElementById('prof-stats-success-rate'); if(profRate) profRate.innerText = successRate;
    filterStatsTransactions();
}

function filterStatsTransactions() {
    const query = document.getElementById('stats-search-input') ? document.getElementById('stats-search-input').value.toLowerCase().trim() : '';
    const statusFilter = document.getElementById('stats-status-filter') ? document.getElementById('stats-status-filter').value : 'all';
    const typeFilter = document.getElementById('stats-type-filter') ? document.getElementById('stats-type-filter').value : 'all';
    const listEl = document.getElementById('stats-txn-list');
    
    if(!listEl) return;
    listEl.innerHTML = '';

    const filtered = transactions.filter(t => {
        const nameMatch = (t.name || '').toLowerCase().includes(query) || (t.title || '').toLowerCase().includes(query) || (t.id || '').toLowerCase().includes(query) || (t.comment || '').toLowerCase().includes(query);
        let statusMatch = true;
        if (statusFilter !== 'all') { statusMatch = (statusFilter === 'Fail') ? (t.status === 'Rejected' || t.status === 'Fail') : (t.status === statusFilter); }
        let typeMatch = true;
        if (typeFilter !== 'all') {
            if (typeFilter === 'Received') typeMatch = (t.type === 'in' && !t.isApi && !t.title.toLowerCase().includes('deposit'));
            else if (typeFilter === 'Credit') typeMatch = (t.type === 'in');
            else if (typeFilter === 'Debit') typeMatch = (t.type === 'out');
            else if (typeFilter === 'Api') typeMatch = (t.isApi === true);
            else if (typeFilter === 'Withdraw') typeMatch = (t.title.toLowerCase().includes('withdraw') || t.icon === 'fa-university');
            else if (typeFilter === 'Taxes') typeMatch = (t.title.toLowerCase().includes('fee') || t.title.toLowerCase().includes('maintenance'));
        }
        return nameMatch && statusMatch && typeMatch;
    });

    if(filtered.length === 0) { listEl.innerHTML = '<p class="text-center text-gray-400 p-6 text-xs font-bold font-black">No transactions found</p>'; return; }

    filtered.forEach(txn => {
        let amountClass = ''; let statusColor = 'text-gray-400'; let sign = '';
        if (txn.status === 'Pending') { statusColor = 'text-yellow-500'; amountClass = 'text-yellow-500'; } 
        else if (txn.status === 'Rejected' || txn.status === 'Fail') { statusColor = 'text-red-500'; amountClass = 'text-red-500'; } 
        else {
            if (txn.type === 'in') { statusColor = 'text-green-500'; amountClass = 'text-green-500'; sign = '+'; } 
            else { statusColor = 'text-green-500'; amountClass = 'text-red-500'; sign = '-'; }
        }

        listEl.innerHTML += `
            <div onclick="openTxnModal('${txn.id}')" class="flex justify-between items-center p-4 border-b border-gray-100 hover:bg-gray-50 theme-card cursor-pointer transition-colors font-bold">
                <div class="flex items-center gap-3">
                    <div class="w-11 h-11 rounded-2xl theme-card flex items-center justify-center text-lg border border-gray-200"><i class="fas ${txn.icon}"></i></div>
                    <div><p class="text-sm font-bold text-gray-800">${txn.title}</p><p class="text-[10px] ${statusColor} font-bold mt-0.5">${txn.status} • ${txn.date}</p></div>
                </div>
                <p class="font-black ${amountClass}">${sign}₹${parseFloat(txn.amount).toFixed(2)}</p>
            </div>`;
    });
}

function clearStatsFilters() {
    if(document.getElementById('stats-search-input')) document.getElementById('stats-search-input').value = '';
    if(document.getElementById('stats-status-filter')) document.getElementById('stats-status-filter').value = 'all';
    if(document.getElementById('stats-type-filter')) document.getElementById('stats-type-filter').value = 'all';
    filterStatsTransactions();
}

function updateUI() {
    if (currentBalance !== lastRenderedBalance) { document.querySelectorAll('.global-balance').forEach(el => el.innerText = currentBalance.toFixed(2)); lastRenderedBalance = currentBalance; }
    if (keeperBalance !== lastRenderedKeeper) { document.querySelectorAll('.global-keeper-balance').forEach(el => el.innerText = keeperBalance.toFixed(2)); lastRenderedKeeper = keeperBalance; }
    
    const uiUserInitial = document.getElementById('ui-user-initial');
    if (uiUserInitial) {
        if (currentUser && currentUser.dp) { uiUserInitial.innerHTML = `<img src="${currentUser.dp}" class="w-full h-full object-cover">`; } 
        else if (currentUser) { uiUserInitial.innerHTML = currentUser.name.charAt(0).toUpperCase(); }
    }

    const listEl = document.getElementById('home-txn-list'); 
    if(!listEl) return;

    let visibleTxns = transactions.filter(t => !(currentUser?.hiddenTxns && currentUser?.hiddenTxns[t.id]));
    let currentTxnSignature = visibleTxns.slice(0,10).map(t => t.id + t.status).join('-');
    
    if (currentTxnSignature !== lastTxnSignature) {
        lastTxnSignature = currentTxnSignature; listEl.innerHTML = '';
        if(visibleTxns.length === 0) return listEl.innerHTML = '<p class="text-center text-gray-400 p-6 text-xs font-bold font-black">No recent transactions</p>';
        
        visibleTxns.slice(0,10).forEach(txn => {
            let amountClass = ''; let titleClass = 'text-gray-800'; let sign = ''; let statusColor = 'text-gray-400';
            if (txn.status === 'Pending') { statusColor = 'text-yellow-500'; amountClass = 'text-yellow-500'; titleClass = 'text-yellow-500'; sign = ''; } 
            else if (txn.status === 'Rejected') { statusColor = 'text-red-500'; amountClass = 'text-red-500'; titleClass = 'text-red-500'; sign = ''; } 
            else {
                if (txn.type === 'in') { statusColor = 'text-green-500'; amountClass = 'text-green-500'; titleClass = 'text-green-500'; sign = '+'; } 
                else { statusColor = 'text-green-500'; amountClass = 'text-red-500'; sign = '-'; }
            }
            listEl.innerHTML += `<div onclick="openTxnModal('${txn.id}')" class="flex justify-between items-center p-4 border-b border-gray-100 hover:bg-gray-50 theme-card cursor-pointer transition-colors"><div class="flex items-center gap-3"><div class="w-11 h-11 rounded-2xl theme-card accent-text flex items-center justify-center text-lg border border-gray-200"><i class="fas ${txn.icon}"></i></div><div><p class="text-sm font-bold ${titleClass}">${txn.title}</p><p class="text-[10px] ${statusColor} font-bold mt-0.5">${txn.status} • ${txn.date}</p></div></div><p class="font-black ${amountClass}">${sign}₹${parseFloat(txn.amount).toFixed(2)}</p></div>`;
        });
    }
}

let currentModalTxnId = '';
function openTxnModal(txnId) { 
    let txn = transactions.find(t => t.id === txnId); if(!txn) return; 
    currentModalTxnId = txn.id; document.getElementById('txnModalIcon').className = `fas ${txn.icon} text-blue-600`; 
    let modalSign = ''; let modalAmtClass = ''; let titleClass = 'text-gray-800';

    if (txn.status === 'Pending') { modalSign = ''; modalAmtClass = 'text-yellow-500'; titleClass = 'text-yellow-500'; } 
    else if (txn.status === 'Rejected') { modalSign = ''; modalAmtClass = 'text-red-500'; titleClass = 'text-red-500'; } 
    else {
        if (txn.type === 'in') { modalSign = '+'; modalAmtClass = 'text-green-500'; titleClass = 'text-green-500'; } 
        else { modalSign = '-'; modalAmtClass = 'text-red-500'; }
    }

    document.getElementById('txnModalTitle').innerText = txn.title; document.getElementById('txnModalTitle').className = `text-xl font-black ${titleClass}`;
    document.getElementById('txnModalAmount').innerText = modalSign + '₹' + parseFloat(txn.amount).toFixed(2); document.getElementById('txnModalAmount').className = `text-3xl font-black mt-2 tracking-tight ${modalAmtClass}`; 
    
    const statusEl = document.getElementById('txnModalStatus');
    if (statusEl) {
        statusEl.innerText = txn.status;
        statusEl.className = "text-xs font-black uppercase tracking-wider mt-2 rounded-full px-3 py-1 inline-block";
        if (txn.status === 'Success') { statusEl.style.backgroundColor = 'rgba(34, 197, 94, 0.15)'; statusEl.style.color = '#22c55e'; } 
        else if (txn.status === 'Pending') { statusEl.style.backgroundColor = 'rgba(234, 179, 8, 0.15)'; statusEl.style.color = '#eab308'; } 
        else if (txn.status === 'Rejected' || txn.status === 'Fail') { statusEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'; statusEl.style.color = '#ef4444'; }
    }

    document.getElementById('txnModalType').innerText = txn.type === 'in' ? 'Received' : 'Sent'; 
    document.getElementById('txnModalName').innerText = txn.name || 'N/A'; 
    document.getElementById('txnModalNumber').innerText = txn.number || 'N/A'; 
    document.getElementById('txnModalId').innerText = txn.id; 
    document.getElementById('txnModalComment').innerText = txn.comment && txn.comment.trim() !== '' ? txn.comment : 'None';
    document.getElementById('txnModalDate').innerText = txn.date; 

    const ssContainer = document.getElementById('txnModalScreenshotContainer'); const ssImg = document.getElementById('txnModalScreenshotImg');
    if (txn.screenshot) { if (ssContainer && ssImg) { ssImg.src = txn.screenshot; ssContainer.classList.remove('hidden'); } } else { if (ssContainer) ssContainer.classList.add('hidden'); }

    document.getElementById('txnModal').classList.remove('hidden'); setTimeout(()=>document.getElementById('txnModal').classList.remove('opacity-0'), 10); 
}

function closeTxnModal() { document.getElementById('txnModal').classList.add('opacity-0'); setTimeout(()=>document.getElementById('txnModal').classList.add('hidden'), 300); }
function copyTxnId() { navigator.clipboard.writeText(currentModalTxnId); showToast("Copied!"); }
function showToast(msg) { const toast = document.getElementById('toast'); document.getElementById('toastMsg').innerText = msg; toast.classList.remove('hidden'); setTimeout(()=>toast.classList.remove('opacity-0'),10); setTimeout(()=>{toast.classList.add('opacity-0'); setTimeout(()=>toast.classList.add('hidden'),300);}, 3000); }
function copyText(text) { navigator.clipboard.writeText(text); showToast("Copied!"); }

async function showView(viewId) { 
    if (currentUser) { try { await syncData(); } catch(e) {} }
    if (viewId === 'official') { markPostsAsRead(); renderOfficialPosts(); }
    if (viewId === 'game') updateStatsDashboard();
    if (viewId === 'myprofile') updateProfileDashboardUI();
    if (viewId === 'botalert' && currentUser) { document.getElementById('toggle-bot-alert-check-fs').checked = currentUser.botAlerts !== false; document.getElementById('bot-alert-tg-id-fs').value = currentUser.tgUserId || ''; }
    if (viewId === 'lifafa') { if(document.getElementById('lifafa-history').classList.contains('active')) { renderMyLifafas(); } }
    
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active')); 
    document.getElementById('view-' + viewId).classList.add('active'); 
    
    document.querySelectorAll('.nav-item').forEach(el => { 
        el.classList.remove('accent-text'); el.classList.add('text-gray-400'); 
        if(el.innerHTML.includes(viewId)) { el.classList.remove('text-gray-400'); el.classList.add('accent-text'); } 
    }); 
    window.scrollTo({top:0, behavior:'smooth'}); 
}

function toggleSidebar() { const sidebar = document.getElementById('sidebar'); const overlay = document.getElementById('sidebarOverlay'); if(sidebar.classList.contains('-translate-x-full')) { sidebar.classList.remove('-translate-x-full'); overlay.classList.remove('hidden'); setTimeout(()=>overlay.classList.add('opacity-100'),10); } else { sidebar.classList.add('-translate-x-full'); overlay.classList.remove('opacity-100'); setTimeout(()=>overlay.classList.add('hidden'),300); } }
function switchLifafaTab(tabId) { document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active', 'accent-bg', 'text-white')); document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.add('text-[#6b7280]')); document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); let activeBtn = document.getElementById('tab-'+tabId); activeBtn.classList.remove('text-[#6b7280]'); activeBtn.classList.add('active', 'accent-bg', 'text-white'); document.getElementById(tabId).classList.add('active'); if (tabId === 'lifafa-history') renderMyLifafas(); }
function switchKeeperTab(tabId) { document.querySelectorAll('.keeper-tab-btn').forEach(btn => btn.classList.remove('active')); document.querySelectorAll('.keeper-tab-content').forEach(c => c.classList.remove('active')); document.getElementById('btn-'+tabId).classList.add('active'); document.getElementById(tabId).classList.add('active'); }

function startScanner() {
    document.getElementById('scanner-container').classList.remove('hidden'); document.getElementById('scan-result').classList.add('hidden');
    if (html5QrcodeScanner) { try { html5QrcodeScanner.clear(); } catch(e) {} }
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start( { facingMode: "environment" }, { fps: 10, qrbox: 250 }, handleQRResult, (err) => {} )
    .catch(err => { html5QrcodeScanner.start({ facingMode: "user" }, { fps: 10, qrbox: 250 }, handleQRResult, () => {}).catch(e => showToast("Camera access failed.")); });
}

function stopScanner() { if(html5QrcodeScanner) { html5QrcodeScanner.stop().then(()=>html5QrcodeScanner.clear()).catch(()=>{}); } }

function handleQRResult(text) {
    playSound('success'); stopScanner(); 
    let parsedName = "Unknown", parsedNumber = text;
    if(text.startsWith("NGSOLUTION:")) { let parts = text.split(":"); if(parts.length>=3) { parsedNumber = parts[1]; parsedName = decodeURIComponent(parts[2]); } }
    document.getElementById('scanner-container').classList.add('hidden'); document.getElementById('scan-result').classList.remove('hidden');
    document.getElementById('scan-res-name').innerText = parsedName; document.getElementById('scan-res-phone').innerText = parsedNumber;
    document.getElementById('scan-amt').value = ''; document.getElementById('scan-pin').value = ''; document.getElementById('scan-comment').value = '';
}

function resetScanner() { startScanner(); }

function handleQRUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    showToast("Scanning image..."); const html5QrCode = new Html5Qrcode("reader");
    html5QrCode.scanFile(file, true).then(decodedText => { handleQRResult(decodedText); document.getElementById('qr-upload').value = ''; })
    .catch(err => { showToast("Invalid QR Code or unable to read."); document.getElementById('qr-upload').value = ''; });
}

function searchTxn() {
    let tid = document.getElementById('search-txn-id').value.trim().toUpperCase(); if(!tid) return showToast("Enter Transaction ID");
    let txn = transactions.find(t => t.id === tid);
    if(txn) { openTxnModal(txn.id); document.getElementById('search-txn-id').value = ''; } else { showToast("Transaction not found in your history."); }
}

window.onload = async () => {
    await handleSplashScreen();
    await checkAuth();
};
