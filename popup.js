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
    statsBtn.addEventListener('click', () => {
        showStats();
    });

    backBtn.addEventListener('click', () => {
        statsView.classList.add('hidden');
    });

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
        const data = await chrome.storage.local.get(['parkingHistory', 'selectedLot']);
        const history = data.parkingHistory || [];
        const selectedName = data.selectedLot || "Unknown";

        // Filter history for currently selected lot
        const lotHistory = history.filter(h => h.lotName === selectedName);

        if (lotHistory.length === 0) {
            statsMessage.textContent = "No history available for " + selectedName;
            statsMessage.classList.remove('hidden');
            if (parkingChart) parkingChart.destroy();
            return;
        }
        statsMessage.classList.add('hidden');

        // Prepare data for Chart.js
        const labels = lotHistory.map(h => new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        const dataPoints = lotHistory.map(h => h.spaces);
        const backgroundColors = dataPoints.map(val => {
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
                    label: 'Free Spaces',
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
                        text: 'History for ' + selectedName
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
