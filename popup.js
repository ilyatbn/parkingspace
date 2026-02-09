document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const parkingList = document.getElementById('parkingList');
    const message = document.getElementById('message');
    const refreshBtn = document.getElementById('refreshBtn');
    const statsBtn = document.getElementById('statsBtn');
    const backBtn = document.getElementById('backBtn');
    const statsView = document.getElementById('statsView');
    const statsMessage = document.getElementById('statsMessage');

    let allParkingLots = [];
    let selectedLotName = null;
    let parkingChart = null;

    // Load data initially
    loadData();

    // Listen for storage changes to auto-update UI
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.parkingLots) {
            loadData();
            // Stop spin if it was spinning
            refreshBtn.classList.remove('spin');
        }
    });

    // Refresh button click
    refreshBtn.addEventListener('click', () => {
        refreshBtn.classList.add('spin');
        chrome.runtime.sendMessage({ action: "refreshData" });
        // Fallback: stop spin after 5s if no update comes (e.g., fetch error)
        setTimeout(() => {
            refreshBtn.classList.remove('spin');
        }, 5000);
    });

    // Stats Navigation
    const daySelect = document.getElementById('daySelect');
    const metricSelect = document.getElementById('metricSelect');
    const periodSelect = document.getElementById('periodSelect');

    statsBtn.addEventListener('click', () => {
        // Set default day to today
        const today = new Date().getDay();
        daySelect.value = today.toString();
        // Set default period to day
        periodSelect.value = 'day';
        showStats();
    });

    backBtn.addEventListener('click', () => {
        statsView.classList.add('hidden');
    });

    daySelect.addEventListener('change', renderChart);
    metricSelect.addEventListener('change', renderChart);
    periodSelect.addEventListener('change', renderChart);

    function loadData() {
        chrome.storage.local.get(['parkingLots', 'selectedLot'], (result) => {
            if (result.selectedLot) {
                selectedLotName = result.selectedLot;
            }

            if (result.parkingLots) {
                allParkingLots = result.parkingLots;
                renderList(allParkingLots);
            } else {
                message.textContent = "No data available. Background script fetching...";
                message.classList.remove('hidden');
            }
        });
    }

    // Search functionality
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allParkingLots.filter(lot =>
            lot.name.toLowerCase().includes(query) ||
            lot.address.toLowerCase().includes(query)
        );
        renderList(filtered);
    });

    function renderList(lots) {
        parkingList.innerHTML = '';
        if (lots.length === 0) {
            message.textContent = "No parking lots found matching your search.";
            message.classList.remove('hidden');
            return;
        }
        message.classList.add('hidden');

        // Pinning logic: Use a copy to sort
        let displayLots = [...lots];
        if (selectedLotName && !searchInput.value) { // Only pin if not searching (or maybe pin in search too? User said "top when opening menu", usually implies default view)
            const index = displayLots.findIndex(l => l.name === selectedLotName);
            if (index > -1) {
                const selected = displayLots.splice(index, 1)[0];
                displayLots.unshift(selected);
            }
        }

        displayLots.forEach(lot => {
            const item = document.createElement('div');
            item.className = 'parking-item';
            if (lot.name === selectedLotName) {
                item.classList.add('selected');
            }

            // Create inner HTML structure
            item.innerHTML = `
                <div class="parking-info">
                    <div class="parking-name">${escapeHtml(lot.name)}</div>
                    <div class="parking-address">${escapeHtml(lot.address)}</div>
                </div>
                <div class="parking-count">${lot.freeParkingNumber}</div>
            `;

            item.addEventListener('click', () => {
                selectLot(lot.name);
            });

            parkingList.appendChild(item);
        });
    }

    function selectLot(name) {
        selectedLotName = name;
        chrome.storage.local.set({ selectedLot: name }, () => {
            // Re-render to update selection style and pin
            renderList(allParkingLots.filter(lot => {
                // Respect current search filtering if any, actually we should just re-run render with current filtered list
                // For simplicity, let's just re-load data/filter based on search input
                const query = searchInput.value.toLowerCase();
                return lot.name.toLowerCase().includes(query) || lot.address.toLowerCase().includes(query);
            }));

            // Notify background to update badge
            chrome.runtime.sendMessage({ action: "updateBadge" });
        });
    }

    function showStats() {
        statsView.classList.remove('hidden');
        renderChart();
    }

    async function renderChart() {
        const selectedDay = parseInt(daySelect.value);
        const selectedMetric = metricSelect.value;
        const selectedPeriod = periodSelect.value;

        // Determine keys to fetch
        const currentDayKey = `historyStats${selectedDay}`;
        const nextDayIndex = (selectedDay + 1) % 7;
        const nextDayKey = `historyStats${nextDayIndex}`;

        const keysToFetch = [currentDayKey, 'selectedLot', 'parkingLots'];
        if (selectedPeriod === 'night') {
            keysToFetch.push(nextDayKey);
        }

        const data = await chrome.storage.local.get(keysToFetch);
        const currentDayStats = data[currentDayKey] || {};
        const nextDayStats = data[nextDayKey] || {};
        const selectedName = data.selectedLot || "Unknown";
        const parkingLots = data.parkingLots || [];

        // Find live data
        let liveValue = null;
        const liveLot = parkingLots.find(p => p.name === selectedName);
        if (liveLot) {
            liveValue = liveLot.freeParkingNumber;
        }

        // Current time
        const now = new Date();
        const nowDay = now.getDay();
        const nowHour = now.getHours();

        // Define hours based on period
        let hoursMap = []; // Array of { label, hour, day, stats }
        if (selectedPeriod === 'day') {
            // 08:00 to 19:00 (12 hours) from current day
            for (let h = 8; h < 20; h++) {
                hoursMap.push({ label: `${h.toString().padStart(2, '0')}:00`, hour: h, day: selectedDay, stats: currentDayStats });
            }
        } else {
            // Night: 20:00 to 07:00 (12 hours)
            // 20-23 from currentDay
            for (let h = 20; h < 24; h++) {
                hoursMap.push({ label: `${h.toString().padStart(2, '0')}:00`, hour: h, day: selectedDay, stats: currentDayStats });
            }
            // 00-07 from nextDay
            for (let h = 0; h < 8; h++) {
                hoursMap.push({ label: `${h.toString().padStart(2, '0')}:00`, hour: h, day: nextDayIndex, stats: nextDayStats });
            }
        }

        const labels = hoursMap.map(hm => hm.label);
        const dataPoints = [];
        const liveDataPoints = [];
        let hasData = false;

        for (const item of hoursMap) {
            // Historical Data
            const hourSamples = item.stats[item.hour] || [];
            const lotSamples = hourSamples.filter(s => s.lotName === selectedName);

            if (lotSamples.length > 0) {
                hasData = true;
                const values = lotSamples.map(s => s.spaces);
                let val;
                if (selectedMetric === 'max') {
                    val = Math.max(...values);
                } else if (selectedMetric === 'min') {
                    val = Math.min(...values);
                } else {
                    const sum = values.reduce((a, b) => a + b, 0);
                    val = Math.round(sum / values.length);
                }
                dataPoints.push(val);
            } else {
                dataPoints.push(null);
            }

            // Live Data
            if (item.day === nowDay && item.hour === nowHour && liveValue !== null) {
                liveDataPoints.push(liveValue);
                hasData = true; // Show chart even if only live data exists
            } else {
                liveDataPoints.push(null);
            }
        }

        if (!hasData) {
            statsMessage.textContent = `No history for ${selectedName} in this period.`;
            statsMessage.classList.remove('hidden');
            if (parkingChart) parkingChart.destroy();
            return;
        }
        statsMessage.classList.add('hidden');

        const backgroundColors = dataPoints.map(val => {
            if (val === null || val === undefined) return '#ccc';
            if (val === 0) return '#F44336';
            if (val < 20) return '#FF9800';
            if (val < 30) return '#FFEB3B';
            return '#4CAF50';
        });

        const ctx = document.getElementById('parkingChart').getContext('2d');

        if (parkingChart) {
            parkingChart.destroy();
        }

        parkingChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: `Spaces (${selectedMetric})`,
                        data: dataPoints,
                        backgroundColor: backgroundColors,
                        borderWidth: 1,
                        order: 2
                    },
                    {
                        label: 'Live',
                        data: liveDataPoints,
                        backgroundColor: 'rgba(255, 105, 180, 0.5)', // Pink transparent
                        borderColor: 'rgba(255, 105, 180, 1)',
                        borderWidth: 1,
                        grouped: false, // Overlay on top
                        order: 1, // Draw last (on top)
                        barPercentage: 1.0, // Make it wider or same? 
                        categoryPercentage: 0.8 // Match default
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Spaces'
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: `${selectedName} - ${daySelect.options[daySelect.selectedIndex].text} (${selectedPeriod})`
                    },
                    legend: {
                        display: true,
                        labels: {
                            boxWidth: 10
                        }
                    }
                }
            }
        });
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
