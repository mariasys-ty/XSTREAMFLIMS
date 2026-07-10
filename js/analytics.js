window.Analytics = {
    cacheHitRate: 94,
    
    init() {
        this.renderDeviceAnalytics();
        this.renderNetworkAnalytics();
        this.renderCacheStats();
        this.renderWorkerStatus();
    },
    
    renderDeviceAnalytics() {
        const div = document.getElementById('device-chart');
        const data = { 'High-End': 45, 'Mid-Range': 35, 'Low-End': 20 };
        const max = Math.max(...Object.values(data));
        
        if (!div) return;
        div.innerHTML = Object.entries(data).map(([k, v]) => `
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                <div style="width:80px; font-size:0.8rem; color:#aaa;">${k}</div>
                <div style="flex:1; background:rgba(255,255,255,0.1); border-radius:4px; height:8px;">
                    <div style="width:${(v/max)*100}%; background:var(--accent); height:100%; border-radius:4px;"></div>
                </div>
                <div style="font-size:0.8rem; width:30px;">${v}%</div>
            </div>
        `).join('');
    },
    
    renderNetworkAnalytics() {
        const div = document.getElementById('network-chart');
        const data = { '4G/5G': 60, 'WiFi': 30, '3G': 10 };
        const max = Math.max(...Object.values(data));
        
        if (!div) return;
        div.innerHTML = Object.entries(data).map(([k, v]) => `
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                <div style="width:80px; font-size:0.8rem; color:#aaa;">${k}</div>
                <div style="flex:1; background:rgba(255,255,255,0.1); border-radius:4px; height:8px;">
                    <div style="width:${(v/max)*100}%; background:var(--success); height:100%; border-radius:4px;"></div>
                </div>
                <div style="font-size:0.8rem; width:30px;">${v}%</div>
            </div>
        `).join('');
    },
    
    renderCacheStats() {
        const statsDiv = document.getElementById('cache-stats');
        if (!statsDiv) return;
        statsDiv.innerHTML = `
            <div class="stat-card"><h3>Cache Size</h3><div class="value">12.4 MB</div></div>
            <div class="stat-card"><h3>Hit Rate</h3><div class="value" style="color:var(--success)">${this.cacheHitRate}%</div></div>
            <div class="stat-card"><h3>Expired Entries</h3><div class="value">14</div></div>
            <div class="stat-card"><h3>Memory Saved</h3><div class="value">240 MB</div></div>
        `;
    },
    
    renderWorkerStatus() {
        const card = document.getElementById('worker-status-card');
        if (!card) return;
        const isSupported = 'serviceWorker' in navigator;
        card.innerHTML = `
            <h3>Service Worker Status</h3>
            <div class="grid-2-col" style="margin-top:15px;">
                <div class="detail-group"><h4>Supported</h4><p>${isSupported ? 'Yes' : 'No'}</p></div>
                <div class="detail-group"><h4>Registered</h4><p>Pending Implementation</p></div>
                <div class="detail-group"><h4>Offline Pages</h4><p>2 Cached</p></div>
                <div class="detail-group"><h4>Update Status</h4><p>Up to date</p></div>
            </div>
            <div style="margin-top:20px;">
                <button class="btn-sm btn-primary" onclick="SFAdmin.addLog('Worker Update Triggered', 'info')">Force Update</button>
                <button class="btn-sm btn-danger" onclick="SFAdmin.addLog('Worker Unregistered', 'warn')">Unregister</button>
            </div>
        `;
    },
    
    updateCacheHitRate() {
        this.cacheHitRate = Math.max(70, Math.min(100, this.cacheHitRate + (Math.random() * 4 - 2)));
        this.renderCacheStats();
    }
};