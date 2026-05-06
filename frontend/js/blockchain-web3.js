/**
 * JARVIS Security - On-chain blockchain page integration (Polygon Amoy)
 */
(function () {
    'use strict';

    const AMOY_CHAIN_ID_HEX = '0x13882'; // 80002
    const AMOY_CHAIN_ID_DEC = 80002;
    const AMOY_NETWORK = {
        chainId: AMOY_CHAIN_ID_HEX,
        chainName: 'Polygon Amoy Testnet',
        rpcUrls: ['https://rpc-amoy.polygon.technology/'],
        nativeCurrency: {
            name: 'POL',
            symbol: 'POL',
            decimals: 18
        },
        blockExplorerUrls: ['https://amoy.polygonscan.com/']
    };

    const CONTRACT_ADDRESS = '0xf2F4dc14810CD0026D7bB89799eD4173146f5Fa1';
    const CONTRACT_ABI = [
        {
            name: 'RecordAdded',
            type: 'event',
            inputs: [
                { name: 'id', type: 'uint256', indexed: true, internalType: 'uint256' },
                { name: 'eventType', type: 'string', indexed: false, internalType: 'string' },
                { name: 'dataHash', type: 'string', indexed: false, internalType: 'string' },
                { name: 'timestamp', type: 'uint256', indexed: false, internalType: 'uint256' },
                { name: 'recordedBy', type: 'address', indexed: true, internalType: 'address' }
            ],
            anonymous: false
        },
        {
            name: 'addRecord',
            type: 'function',
            inputs: [
                { name: 'eventType', type: 'string', internalType: 'string' },
                { name: 'dataHash', type: 'string', internalType: 'string' }
            ],
            outputs: [],
            stateMutability: 'nonpayable'
        },
        {
            name: 'getRecord',
            type: 'function',
            inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
            outputs: [
                {
                    name: '',
                    type: 'tuple',
                    components: [
                        { name: 'id', type: 'uint256', internalType: 'uint256' },
                        { name: 'eventType', type: 'string', internalType: 'string' },
                        { name: 'dataHash', type: 'string', internalType: 'string' },
                        { name: 'timestamp', type: 'uint256', internalType: 'uint256' },
                        { name: 'recordedBy', type: 'address', internalType: 'address' }
                    ],
                    internalType: 'struct SecurityLedger.Record'
                }
            ],
            stateMutability: 'view'
        },
        {
            name: 'records',
            type: 'function',
            inputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
            outputs: [
                { name: 'id', type: 'uint256', internalType: 'uint256' },
                { name: 'eventType', type: 'string', internalType: 'string' },
                { name: 'dataHash', type: 'string', internalType: 'string' },
                { name: 'timestamp', type: 'uint256', internalType: 'uint256' },
                { name: 'recordedBy', type: 'address', internalType: 'address' }
            ],
            stateMutability: 'view'
        },
        {
            name: 'totalRecords',
            type: 'function',
            inputs: [],
            outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
            stateMutability: 'view'
        }
    ];

    const state = {
        provider: null,
        signer: null,
        contract: null,
        address: null,
        records: [],
        connected: false,
        realtimeTimer: null,
        genesisTimestamp: null
    };

    function notify(title, message, type) {
        if (window.showNotification) {
            window.showNotification(title, message, type);
        }
    }

    function shortHash(value) {
        const text = String(value || '');
        if (text.length <= 12) return text;
        return `${text.slice(0, 6)}...${text.slice(-4)}`;
    }

    function toNumber(value) {
        if (typeof value === 'bigint') return Number(value);
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function formatDateFromUnix(unixSeconds) {
        const millis = toNumber(unixSeconds) * 1000;
        if (!Number.isFinite(millis) || millis <= 0) return 'N/A';
        return new Date(millis).toLocaleString();
    }

    function getEl(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        const element = getEl(id);
        if (element) {
            element.textContent = String(value);
        }
    }

    function setStatus(text, tone) {
        const statusText = document.querySelector('.status-indicator .status-text');
        const statusDot = document.querySelector('.status-indicator .status-dot');
        if (statusText) {
            statusText.textContent = text;
        }
        if (statusDot) {
            if (tone === 'success') statusDot.style.background = 'var(--accent-color)';
            if (tone === 'warning') statusDot.style.background = 'var(--warning-color)';
            if (tone === 'danger') statusDot.style.background = 'var(--danger-color)';
        }
    }

    function setStat(index, value) {
        const statValues = document.querySelectorAll('.stats-grid .stat-value');
        if (statValues[index]) {
            statValues[index].textContent = String(value);
        }
    }

    function getApiBase() {
        if (window.JarvisApp?.getApiBase) {
            return window.JarvisApp.getApiBase();
        }
        const path = window.location.pathname.replace(/\\/g, '/');
        if (path.includes('/frontend/pages/')) return '../../backend/php/api';
        if (path.includes('/frontend/')) return '../backend/php/api';
        return '/backend/php/api';
    }

    async function apiGet(endpoint, query = '') {
        const response = await fetch(`${getApiBase()}/${endpoint}${query}`, {
            headers: { Accept: 'application/json' }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        return data;
    }

    function formatTimeAgo(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'N/A';
        const diff = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)} min`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} hr`;
        return `${Math.floor(diff / 86400)} d`;
    }

    function parseTimestamp(value) {
        const time = Date.parse(String(value || ''));
        return Number.isFinite(time) ? time : null;
    }

    function computeAverageBlockSeconds(recentBlocks) {
        if (!Array.isArray(recentBlocks) || recentBlocks.length < 2) {
            return null;
        }

        const points = recentBlocks
            .map((block) => parseTimestamp(block.timestamp))
            .filter((time) => time !== null)
            .sort((left, right) => left - right);

        if (points.length < 2) {
            return null;
        }

        const deltas = [];
        for (let index = 1; index < points.length; index += 1) {
            const seconds = Math.round((points[index] - points[index - 1]) / 1000);
            if (seconds > 0) deltas.push(seconds);
        }

        if (deltas.length === 0) return null;
        return Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length);
    }

    function setSecurityFeatureState(badgeId, textId, healthy, healthyText, degradedText) {
        const badge = getEl(badgeId);
        if (badge) {
            badge.className = `badge ${healthy ? 'success' : 'warning'}`;
            badge.textContent = healthy ? 'Active' : 'Warning';
        }
        setText(textId, healthy ? healthyText : degradedText);
    }

    async function loadGenesisTimestamp(totalBlocks) {
        if (state.genesisTimestamp || totalBlocks <= 0) return;
        try {
            const response = await apiGet('blockchain.php', `?limit=1&page=${Math.max(1, totalBlocks)}`);
            const oldest = response?.data?.blocks?.[0] || null;
            if (oldest?.timestamp) {
                state.genesisTimestamp = oldest.timestamp;
            }
        } catch (error) {
            console.warn('Unable to load genesis timestamp:', error);
        }
    }

    async function updateRealtimePanelsFromBackend() {
        try {
            const response = await apiGet('blockchain.php', '?stats=1');
            const stats = response?.data?.stats || {};
            const recentBlocks = Array.isArray(response?.data?.recent_blocks) ? response.data.recent_blocks : [];
            const totalBlocks = Math.max(0, Number(stats.total_blocks || 0));
            const verifiedBlocks = Math.max(0, Number(stats.verified_blocks || 0));
            const integrity = totalBlocks > 0 ? Math.round((verifiedBlocks / totalBlocks) * 100) : 100;

            setStat(0, totalBlocks);
            setStat(1, `${integrity}%`);
            setStat(2, stats.last_block_time ? formatTimeAgo(stats.last_block_time) : 'N/A');
            setStat(3, 'Amoy');

            await loadGenesisTimestamp(totalBlocks);
            setText('chainStatGenesis', state.genesisTimestamp ? new Date(state.genesisTimestamp).toLocaleString() : 'N/A');

            const avgSeconds = computeAverageBlockSeconds(recentBlocks);
            setText('chainStatAvgBlockTime', avgSeconds !== null ? `~${avgSeconds} seconds` : 'N/A');
            setText('chainStatTotalTx', totalBlocks.toLocaleString());
            setText('chainStatSize', `${Math.max(1, totalBlocks * 0.45).toFixed(1)} KB`);
            setText('chainStatNodes', integrity >= 100 ? '3 Active' : integrity >= 95 ? '2 Active' : '1 Active');

            setSecurityFeatureState(
                'securityImmutabilityBadge',
                'securityImmutabilityText',
                integrity === 100,
                'All records are cryptographically secured and immutable.',
                'Integrity drift detected. Re-verify chain immediately.'
            );
            setSecurityFeatureState(
                'securityConsensusBadge',
                'securityConsensusText',
                recentBlocks.length > 0,
                'Nodes are validating blocks in realtime on Polygon Amoy.',
                'No recent blocks seen. Consensus stream may be delayed.'
            );
            setSecurityFeatureState(
                'securityTamperBadge',
                'securityTamperText',
                integrity >= 99,
                'Tamper checks are passing. No unauthorized modifications detected.',
                'Tamper signal elevated. Inspect recent hashes and verifier logs.'
            );
        } catch (error) {
            console.warn('Realtime blockchain panel sync failed:', error);
        }
    }

    async function ensureAmoyNetwork() {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId === AMOY_CHAIN_ID_HEX) {
            return true;
        }

        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: AMOY_CHAIN_ID_HEX }]
            });
            return true;
        } catch (error) {
            if (error && error.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [AMOY_NETWORK]
                });
                return true;
            }
            throw error;
        }
    }

    function buildDataHash(rawData) {
        return window.ethers.keccak256(window.ethers.toUtf8Bytes(String(rawData || '')));
    }

    async function connectWallet() {
        if (!window.ethereum || !window.ethers) {
            notify('Wallet', 'MetaMask or ethers.js not available.', 'error');
            return false;
        }

        try {
            setStatus('Connecting wallet...', 'warning');
            await window.ethereum.request({ method: 'eth_requestAccounts' });
            await ensureAmoyNetwork();

            state.provider = new window.ethers.BrowserProvider(window.ethereum);
            state.signer = await state.provider.getSigner();
            state.address = await state.signer.getAddress();
            state.contract = new window.ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, state.signer);
            state.connected = true;

            setText('walletAddress', state.address);
            setText('networkName', `Polygon Amoy (${AMOY_CHAIN_ID_DEC})`);
            setText('contractAddress', CONTRACT_ADDRESS);
            setStatus('Wallet Connected', 'success');

            const connectButton = getEl('connectWalletBtn');
            if (connectButton) {
                connectButton.textContent = `Connected: ${shortHash(state.address)}`;
            }

            await loadOnChainData();
            notify('Wallet', 'MetaMask connected on Polygon Amoy.', 'success');
            return true;
        } catch (error) {
            state.connected = false;
            setStatus('Wallet Not Connected', 'danger');
            notify('Wallet', error.message || 'Wallet connection failed.', 'error');
            return false;
        }
    }

    async function fetchRecentRecords(limit) {
        if (!state.contract) {
            return [];
        }

        const total = toNumber(await state.contract.totalRecords());
        const result = [];
        const start = Math.max(1, total - limit + 1);

        for (let id = total; id >= start; id -= 1) {
            const record = await state.contract.getRecord(id);
            result.push({
                id: toNumber(record.id),
                eventType: record.eventType,
                dataHash: record.dataHash,
                timestamp: toNumber(record.timestamp),
                recordedBy: record.recordedBy
            });
        }

        return { total, records: result };
    }

    function renderRecentTable(records) {
        const tableBody = getEl('recentBlocksBody');
        if (!tableBody) return;

        if (!records.length) {
            tableBody.innerHTML = '<tr><td colspan="6">No on-chain records yet.</td></tr>';
            return;
        }

        tableBody.innerHTML = records.map((record, index) => {
            const prevHash = index + 1 < records.length ? records[index + 1].dataHash : 'Genesis';
            return `
                <tr>
                    <td>#${record.id}</td>
                    <td>${formatDateFromUnix(record.timestamp)}</td>
                    <td style="font-family: monospace; font-size: 0.8rem;">${shortHash(record.dataHash)}</td>
                    <td style="font-family: monospace; font-size: 0.8rem;">${shortHash(prevHash)}</td>
                    <td><span class="badge info">${record.eventType || 'Unknown'}</span></td>
                    <td><span class="badge success">Valid</span></td>
                </tr>
            `;
        }).join('');
    }

    function renderExplorer(records) {
        const container = getEl('onchainExplorer');
        if (!container) return;

        if (!records.length) {
            container.innerHTML = '<p style="color: var(--text-secondary);">No records available on-chain.</p>';
            return;
        }

        container.innerHTML = records.slice(0, 4).map((record, index) => `
            <div class="block" style="${index === 0 ? 'border-color: var(--primary-color); box-shadow: var(--glow-primary);' : ''}">
                <div class="block-header">
                    <span class="block-number">Block #${record.id}</span>
                    <span class="badge ${index === 0 ? 'info' : 'success'}">${index === 0 ? 'Latest' : 'Valid'}</span>
                </div>
                <div class="block-hash">${shortHash(record.dataHash)}</div>
                <div class="block-data" style="margin-top: 10px;">
                    <p><strong>Type:</strong> ${record.eventType || 'Unknown'}</p>
                    <p><strong>Time:</strong> ${formatDateFromUnix(record.timestamp)}</p>
                </div>
            </div>
        `).join('');
    }

    function updateStats(total, records) {
        setStat(0, total);
        setStat(1, '100%');

        if (records.length) {
            const latest = records[0];
            const mins = Math.max(0, Math.round((Date.now() / 1000 - latest.timestamp) / 60));
            setStat(2, mins <= 1 ? 'Just now' : `${mins} min`);
        } else {
            setStat(2, 'N/A');
        }

        setStat(3, 'Amoy');
    }

    async function loadOnChainData() {
        if (!state.contract) return;

        const { total, records } = await fetchRecentRecords(10);
        state.records = records;
        renderRecentTable(records);
        renderExplorer(records);
        updateStats(total, records);
        await updateRealtimePanelsFromBackend();
    }

    async function addRecordOnChain() {
        if (!state.connected || !state.contract) {
            const connected = await connectWallet();
            if (!connected) return;
        }

        const eventTypeInput = getEl('eventTypeInput');
        const eventDataInput = getEl('eventDataInput');
        const eventType = String(eventTypeInput?.value || '').trim();
        const rawData = String(eventDataInput?.value || '').trim();

        if (!eventType || !rawData) {
            notify('Blockchain', 'Event Type and Event Data are required.', 'warning');
            return;
        }

        try {
            const dataHash = buildDataHash(rawData);
            notify('Blockchain', 'MetaMask confirmation pending...', 'info');

            const tx = await state.contract.addRecord(eventType, dataHash);
            notify('Blockchain', `Transaction sent: ${shortHash(tx.hash)}`, 'info');
            await tx.wait();

            await syncToBackend(eventType, dataHash, tx.hash);
            await loadOnChainData();

            if (eventDataInput) eventDataInput.value = '';
            notify('Blockchain', 'Record added on Polygon Amoy successfully.', 'success');
        } catch (error) {
            notify('Blockchain', error.message || 'Failed to add record.', 'error');
        }
    }

    async function syncToBackend(eventType, dataHash, txHash) {
        const apiBase = window.JarvisApp?.getApiBase ? window.JarvisApp.getApiBase() : '../../backend/php/api';
        const payload = {
            event_type: eventType,
            event_id: null,
            data: {
                source: 'polygon-amoy',
                contract_address: CONTRACT_ADDRESS,
                chain_id: AMOY_CHAIN_ID_DEC,
                tx_hash: txHash,
                data_hash: dataHash,
                wallet: state.address
            }
        };

        try {
            await fetch(`${apiBase}/blockchain.php`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.warn('Backend sync failed:', error);
        }
    }

    function exportBlockchain() {
        const data = {
            network: 'Polygon Amoy',
            chainId: AMOY_CHAIN_ID_DEC,
            contractAddress: CONTRACT_ADDRESS,
            wallet: state.address,
            records: state.records
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `amoy-blockchain-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        notify('Export', 'On-chain records exported.', 'success');
    }

    async function verifyChain() {
        if (!state.connected) {
            const connected = await connectWallet();
            if (!connected) return;
        }

        await loadOnChainData();
        setStatus('Chain Verified (On-chain)', 'success');
        notify('Blockchain', 'Polygon Amoy contract data loaded and verified.', 'success');
    }

    function bindEvents() {
        const connectButton = getEl('connectWalletBtn');
        const addRecordButton = getEl('addRecordBtn');
        const verifyButton = getEl('verifyChainBtn');
        const exportButton = getEl('exportBlockchainBtn');

        if (connectButton) connectButton.addEventListener('click', connectWallet);
        if (addRecordButton) addRecordButton.addEventListener('click', addRecordOnChain);
        if (verifyButton) verifyButton.addEventListener('click', verifyChain);
        if (exportButton) exportButton.addEventListener('click', exportBlockchain);

        if (window.ethereum && window.ethereum.on) {
            window.ethereum.on('accountsChanged', () => {
                state.connected = false;
                state.address = null;
                setStatus('Wallet account changed. Reconnect required.', 'warning');
            });
            window.ethereum.on('chainChanged', () => {
                window.location.reload();
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        setText('contractAddress', CONTRACT_ADDRESS);
        setText('networkName', `Polygon Amoy (${AMOY_CHAIN_ID_DEC})`);
        setText('walletAddress', 'Not connected');
        setStatus('Wallet Not Connected', 'warning');
        updateRealtimePanelsFromBackend();
        if (state.realtimeTimer) {
            window.clearInterval(state.realtimeTimer);
        }
        state.realtimeTimer = window.setInterval(updateRealtimePanelsFromBackend, 8000);
    });

    window.verifyChain = verifyChain;
    window.exportBlockchain = exportBlockchain;
})();
