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

    statsBtn.addEventListener('click', () => {
        // Set default day to today
        const today = new Date().getDay();
        daySelect.value = today.toString();
        showStats();
    });

    backBtn.addEventListener('click', () => {
        statsView.classList.add('hidden');
    });

    daySelect.addEventListener('change', renderChart);
    metricSelect.addEventListener('change', renderChart);

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
        const selectedDay = daySelect.value;
        const selectedMetric = metricSelect.value;
        const key = `historyStats${selectedDay}`;

        const data = await chrome.storage.local.get([key, 'selectedLot']);
        const dayStats = data[key] || {};
        const selectedName = data.selectedLot || "Unknown";

        // We need 24 data points for hours 0-23
        const hours = Array.from({ length: 24 }, (_, i) => i);
        const labels = hours.map(h => `${h.toString().padStart(2, '0')}:00`);
        const dataPoints = [];

        let hasData = false;

        for (let i = 0; i < 24; i++) {
            const hourSamples = dayStats[i] || [];
            // Filter samples for the selected lot
            const lotSamples = hourSamples.filter(s => s.lotName === selectedName);

            if (lotSamples.length === 0) {
                dataPoints.push(null); // Or 0? null breaks the bar line, usually good to show no data. But for bar chart 0 is ok if we want to show 'empty'. Let's use 0 or null.
                // If we use null, bar chart just shows nothing there.
                continue;
            }
            hasData = true;

            const values = lotSamples.map(s => s.spaces);
            let val;

            if (selectedMetric === 'max') {
                val = Math.max(...values);
            } else if (selectedMetric === 'min') {
                val = Math.min(...values);
            } else {
                // Average
                const sum = values.reduce((a, b) => a + b, 0);
                val = Math.round(sum / values.length); // Integer average
            }
            dataPoints[i] = val; // Assign to correct index (sparse array or fill others with null/0)
        }

        // Fill empty slots with 0 or skip? Chart.js handles sparse arrays.
        // Let's ensure dataPoints has 24 entries
        for (let i = 0; i < 24; i++) {
            if (dataPoints[i] === undefined) dataPoints[i] = 0; // Use 0 for better visual continuity on bar chart, or null?
            // If I use 0, it implies "0 free spaces" which is RED. 
            // We should distinguish "No Data" vs "0 Spaces".
            // Chart.js skips 'null'.
        }

        // However, if we put null, the bar is missing.
        // If we want to indicate "no data", missing bar is correct.

        if (!hasData) {
            statsMessage.textContent = `No history specific to ${selectedName} for this day.`;
            statsMessage.classList.remove('hidden');
            if (parkingChart) parkingChart.destroy();
            return;
        }
        statsMessage.classList.add('hidden');

        const backgroundColors = dataPoints.map(val => {
            if (val === null || val === undefined) return '#ccc'; // Should not happen if we filter nulls
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
                datasets: [{
                    label: `Free Spaces (${selectedMetric})`,
                    data: dataPoints,
                    backgroundColor: backgroundColors,
                    borderWidth: 1
                }]
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
                        text: `${selectedName} - ${daySelect.options[daySelect.selectedIndex].text}`
                    },
                    legend: {
                        display: false
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
