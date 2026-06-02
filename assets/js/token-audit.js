/**
 * Grokie Inu - AI Token Audit & Trust Score
 * Scans Solana SPL tokens using public RPC and analyzes safety
 */

const RPC_ENDPOINTS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-mainnet.g.alchemy.com/v2/demo',
    'https://rpc.ankr.com/solana',
    'https://solana.public-rpc.com'
];

let currentRpcIndex = 0;

// State
let auditData = {};

// === Main Scan Function ===
async function scanToken() {
    const ca = document.getElementById('tokenCA').value.trim();
    if (!ca || ca.length < 32 || ca.length > 50) {
        alert('Please enter a valid Solana token address.');
        return;
    }

    // Reset & show loading
    document.getElementById('auditResult').classList.remove('active');
    document.getElementById('auditError').classList.remove('active');
    document.getElementById('scanLoading').classList.add('active');
    document.getElementById('scanBtn').disabled = true;

    const steps = ['scanStep1','scanStep2','scanStep3','scanStep4','scanStep5'];
    steps.forEach(s => { document.getElementById(s).classList.remove('active','done'); });

    try {
        // Step 1: Fetch account info
        setStep(steps, 0);
        const accountInfo = await rpcCall('getAccountInfo', [ca, {encoding:'jsonParsed'}]);
        if (!accountInfo || !accountInfo.value) throw new Error('TOKEN_NOT_FOUND');
        await delay(400);
        doneStep(steps, 0);

        // Step 2: Get supply & metadata
        setStep(steps, 1);
        let supplyData = null;
        let largestAccounts = null;
        try {
            supplyData = await rpcCall('getTokenSupply', [ca]);
        } catch(e) { console.warn('getTokenSupply failed:', e.message); }
        try {
            largestAccounts = await rpcCall('getTokenLargestAccounts', [ca]);
        } catch(e) { console.warn('getTokenLargestAccounts failed:', e.message); }
        await delay(400);
        doneStep(steps, 1);

        // Step 3: Analyze authorities
        setStep(steps, 2);
        const parsedData = accountInfo.value.data.parsed;
        const mintInfo = parsedData ? parsedData.info : null;
        await delay(400);
        doneStep(steps, 2);

        // Step 4: Risk detection
        setStep(steps, 3);
        await delay(500);
        doneStep(steps, 3);

        // Step 5: Generate report
        setStep(steps, 4);
        const report = generateReport(ca, mintInfo, supplyData, largestAccounts);
        await delay(400);
        doneStep(steps, 4);

        // Show result
        setTimeout(() => {
            document.getElementById('scanLoading').classList.remove('active');
            displayResult(report);
        }, 300);

    } catch (err) {
        console.error('Scan error:', err);
        document.getElementById('scanLoading').classList.remove('active');
        showError(err.message);
    }

    document.getElementById('scanBtn').disabled = false;
}

// === RPC Helper with fallback ===
async function rpcCall(method, params) {
    let lastError = null;

    // Try each RPC endpoint
    for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
        const rpcUrl = RPC_ENDPOINTS[(currentRpcIndex + i) % RPC_ENDPOINTS.length];
        try {
            const resp = await fetch(rpcUrl, {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({jsonrpc:'2.0', id:1, method, params})
            });

            if (!resp.ok) {
                lastError = new Error('HTTP ' + resp.status);
                continue;
            }

            const data = await resp.json();

            if (data.error) {
                lastError = new Error(data.error.message || 'RPC Error');
                continue;
            }

            // Success — remember this RPC for next call
            currentRpcIndex = (currentRpcIndex + i) % RPC_ENDPOINTS.length;
            return data.result;

        } catch(e) {
            lastError = e;
            console.warn('RPC failed (' + rpcUrl + '):', e.message);
            continue;
        }
    }

    throw lastError || new Error('All RPC endpoints failed');
}

// === Generate Report ===
function generateReport(ca, mintInfo, supplyData, largestAccounts) {
    const report = { ca, checks: [], risks: [], score: 0, info: {}, holders: {} };

    // Token Info
    const supply = supplyData && supplyData.value ? supplyData.value : null;
    const decimals = supply ? supply.decimals : (mintInfo ? mintInfo.decimals : 0);
    const totalSupply = supply ? parseFloat(supply.uiAmountString || supply.amount) : 0;

    report.info = {
        address: ca,
        decimals: decimals,
        supply: totalSupply ? formatNumber(totalSupply) : 'Unknown',
        program: mintInfo ? (mintInfo.isInitialized ? 'Initialized' : 'Not Initialized') : 'Unknown'
    };

    // Authority checks
    const mintAuthority = mintInfo ? mintInfo.mintAuthority : null;
    const freezeAuthority = mintInfo ? mintInfo.freezeAuthority : null;

    // Check: Mint Authority
    if (!mintAuthority) {
        report.checks.push({ text: 'Mint Authority Revoked', status: 'safe', icon: '✅' });
        report.score += 25;
    } else {
        report.checks.push({ text: 'Mint Authority Active — new tokens can be minted', status: 'danger', icon: '🚨' });
        report.risks.push('Mint authority is active. The owner can mint unlimited tokens at any time.');
        report.score += 5;
    }

    // Check: Freeze Authority
    if (!freezeAuthority) {
        report.checks.push({ text: 'Freeze Authority Disabled', status: 'safe', icon: '✅' });
        report.score += 20;
    } else {
        report.checks.push({ text: 'Freeze Authority Active — accounts can be frozen', status: 'warning', icon: '⚠️' });
        report.risks.push('Freeze authority is active. The owner can freeze any holder\'s tokens.');
        report.score += 8;
    }

    // Check: Supply
    if (totalSupply > 0) {
        report.checks.push({ text: 'Token supply is valid (' + report.info.supply + ')', status: 'safe', icon: '✅' });
        report.score += 10;
    } else {
        report.checks.push({ text: 'Could not verify supply', status: 'warning', icon: '⚠️' });
        report.score += 3;
    }

    // Check: Decimals
    if (decimals >= 6 && decimals <= 9) {
        report.checks.push({ text: 'Standard decimals (' + decimals + ')', status: 'safe', icon: '✅' });
        report.score += 5;
    } else if (decimals === 0) {
        report.checks.push({ text: 'Zero decimals (NFT-like)', status: 'warning', icon: '⚠️' });
        report.score += 3;
    } else {
        report.checks.push({ text: 'Non-standard decimals (' + decimals + ')', status: 'warning', icon: '⚠️' });
        report.score += 3;
    }

    // Holder Analysis
    const accounts = largestAccounts && largestAccounts.value ? largestAccounts.value : [];
    const totalHolderSupply = accounts.reduce((sum, a) => sum + parseFloat(a.uiAmount || 0), 0);
    const top1Pct = accounts.length > 0 && totalSupply > 0 ? ((parseFloat(accounts[0].uiAmount || 0) / totalSupply) * 100) : 0;
    const top10Pct = totalSupply > 0 ? ((totalHolderSupply / totalSupply) * 100) : 0;

    report.holders = {
        topHolders: accounts.length,
        top1Percent: top1Pct.toFixed(1),
        top10Percent: top10Pct.toFixed(1)
    };

    // Check: Concentration
    if (top1Pct > 50) {
        report.checks.push({ text: 'Top holder owns ' + top1Pct.toFixed(1) + '% — high concentration', status: 'danger', icon: '🚨' });
        report.risks.push('Single wallet holds over 50% of supply. High dump risk.');
        report.score += 2;
    } else if (top1Pct > 20) {
        report.checks.push({ text: 'Top holder owns ' + top1Pct.toFixed(1) + '% — moderate concentration', status: 'warning', icon: '⚠️' });
        report.score += 10;
    } else if (top1Pct > 0) {
        report.checks.push({ text: 'Top holder owns ' + top1Pct.toFixed(1) + '% — well distributed', status: 'safe', icon: '✅' });
        report.score += 20;
    }

    // Check: Distribution
    if (top10Pct < 80 && accounts.length >= 5) {
        report.checks.push({ text: 'Good distribution among holders', status: 'safe', icon: '✅' });
        report.score += 15;
    } else if (accounts.length < 5) {
        report.checks.push({ text: 'Very few holders detected', status: 'warning', icon: '⚠️' });
        report.risks.push('Less than 5 significant holders. Token may be very new or illiquid.');
        report.score += 3;
    }

    // Cap score at 100
    report.score = Math.min(100, report.score);

    return report;
}

// === Display Result ===
function displayResult(report) {
    auditData = report;

    // Score
    const score = report.score;
    const scoreEl = document.getElementById('scoreNum');
    const fillEl = document.getElementById('scoreFill');
    const labelEl = document.getElementById('scoreLabel');
    const summaryEl = document.getElementById('scoreSummary');

    scoreEl.textContent = score + '/100';
    const circumference = 2 * Math.PI * 52; // r=52
    const offset = circumference - (score / 100) * circumference;
    fillEl.style.strokeDashoffset = offset;

    // Color based on score
    let color, label, summary;
    if (score >= 75) {
        color = '#06d6a0'; label = 'Low Risk';
        summary = 'This token passes most safety checks. Authority settings and distribution look healthy.';
    } else if (score >= 50) {
        color = '#f59e0b'; label = 'Medium Risk';
        summary = 'Some concerns detected. Review the risk flags below before investing.';
    } else {
        color = '#ef4444'; label = 'High Risk';
        summary = 'Multiple red flags detected. Exercise extreme caution with this token.';
    }

    fillEl.style.stroke = color;
    scoreEl.style.color = color;
    labelEl.textContent = label;
    labelEl.style.color = color;
    summaryEl.textContent = summary;

    // Token Info
    const infoHtml = `
        <div class="info-item"><span class="info-label">Contract Address</span><span class="info-value">${report.info.address}</span></div>
        <div class="info-item"><span class="info-label">Decimals</span><span class="info-value">${report.info.decimals}</span></div>
        <div class="info-item"><span class="info-label">Total Supply</span><span class="info-value">${report.info.supply}</span></div>
        <div class="info-item"><span class="info-label">Status</span><span class="info-value">${report.info.program}</span></div>
    `;
    document.getElementById('tokenInfo').innerHTML = infoHtml;

    // Safety Checks
    const checksHtml = report.checks.map(c => `
        <div class="check-item">
            <span class="check-icon">${c.icon}</span>
            <span class="check-text">${c.text}</span>
            <span class="check-status ${c.status}">${c.status.toUpperCase()}</span>
        </div>
    `).join('');
    document.getElementById('safetyChecks').innerHTML = checksHtml;

    // Risk Flags
    if (report.risks.length > 0) {
        document.getElementById('riskSection').style.display = 'block';
        document.getElementById('riskFlags').innerHTML = report.risks.map(r => `
            <div class="risk-item"><span class="risk-icon">⚠️</span><span>${r}</span></div>
        `).join('');
    } else {
        document.getElementById('riskSection').style.display = 'none';
    }

    // Holders
    document.getElementById('holderInfo').innerHTML = `
        <div class="holder-stat"><span class="stat-val">${report.holders.topHolders}</span><span class="stat-lbl">Top Holders Scanned</span></div>
        <div class="holder-stat"><span class="stat-val">${report.holders.top1Percent}%</span><span class="stat-lbl">Largest Holder</span></div>
        <div class="holder-stat"><span class="stat-val">${report.holders.top10Percent}%</span><span class="stat-lbl">Top 10 Combined</span></div>
    `;

    document.getElementById('auditResult').classList.add('active');
}

// === Show Error ===
function showError(msg) {
    let title = 'Scan Failed';
    let desc = 'An error occurred while analyzing the token.';

    if (msg === 'TOKEN_NOT_FOUND' || msg.includes('could not find')) {
        title = 'Token Not Found';
        desc = 'This address does not appear to be a valid SPL token mint. Please check the address and try again.';
    } else if (msg.includes('429') || msg.includes('rate')) {
        title = 'Rate Limited';
        desc = 'Too many requests. Please wait a few seconds and try again.';
    } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
        title = 'Network Error';
        desc = 'Could not connect to Solana RPC. This may be a CORS or network issue. Try again in a moment or check your internet connection.';
    } else if (msg.includes('All RPC endpoints failed')) {
        title = 'Connection Failed';
        desc = 'All RPC endpoints are unavailable. Please try again in a few seconds.';
    }

    document.getElementById('errorTitle').textContent = title;
    document.getElementById('errorMsg').textContent = desc;
    document.getElementById('auditError').classList.add('active');
}

// === Reset ===
function resetAudit() {
    document.getElementById('auditResult').classList.remove('active');
    document.getElementById('auditError').classList.remove('active');
    document.getElementById('scanLoading').classList.remove('active');
    document.getElementById('tokenCA').value = '';
    document.getElementById('tokenCA').focus();
}

// === Copy Report ===
function copyReport() {
    if (!auditData || !auditData.ca) return;

    let text = '🛡️ GROKIE INU — AI TOKEN AUDIT\n';
    text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '📋 Token: ' + auditData.info.address + '\n';
    text += '💰 Supply: ' + auditData.info.supply + '\n';
    text += '🔢 Decimals: ' + auditData.info.decimals + '\n';
    text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '🏆 TRUST SCORE: ' + auditData.score + '/100\n';
    text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '🔐 SAFETY CHECKS:\n';
    auditData.checks.forEach(c => {
        text += '  ' + c.icon + ' ' + c.text + ' [' + c.status.toUpperCase() + ']\n';
    });
    if (auditData.risks.length > 0) {
        text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
        text += '⚠️ RISK FLAGS:\n';
        auditData.risks.forEach(r => { text += '  ⚠️ ' + r + '\n'; });
    }
    text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '👥 Top Holder: ' + auditData.holders.top1Percent + '% | Top 10: ' + auditData.holders.top10Percent + '%\n';
    text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    text += '⚠️ Not financial advice. Always DYOR.\n';
    text += 'Powered by Grokie Inu AI Audit — grokieinu.com/token-audit.html';

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector('.audit-actions .action-btn');
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy Report'; }, 2000);
    });
}

// === Helpers ===
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function setStep(steps, i) {
    document.getElementById(steps[i]).classList.add('active');
}
function doneStep(steps, i) {
    document.getElementById(steps[i]).classList.remove('active');
    document.getElementById(steps[i]).classList.add('done');
}

function formatNumber(num) {
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toLocaleString();
}

// Allow Enter key to scan
document.getElementById('tokenCA').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') scanToken();
});
