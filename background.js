const PARKING_URL = "https://centralpark.co.il/parking";
const ALARM_NAME = "refresh_parking_data";

// Initialize alarm on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 5 });
    console.log("Alarm created: refresh_parking_data");
    fetchParkingData();
});

// Listener for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        console.log("Alarm triggered: refreshing data...");
        fetchParkingData();
    }
});

// Function to fetch and parse data
async function fetchParkingData() {
    try {
        const myHeaders = new Headers();
        myHeaders.append("accept", "*/*");
        myHeaders.append("accept-language", "en-US,en;q=0.5");
        myHeaders.append("next-url", "/he/parking");
        myHeaders.append("referer", "https://centralpark.co.il/parking");
        myHeaders.append("rsc", "1");
        myHeaders.append("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36");
        myHeaders.append("Cookie", "NEXT_LOCALE=he");

        const requestOptions = {
            method: "GET",
            headers: myHeaders,
            redirect: "follow"
        };

        const response = await fetch(PARKING_URL, requestOptions);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const text = await response.text();
        const parkingLots = parseParkingData(text);

        if (parkingLots && parkingLots.length > 0) {
            // Save to local storage
            await chrome.storage.local.set({ parkingLots: parkingLots });
            console.log("Parking data saved to storage.");
            updateBadge();
            saveHistory();
        } else {
            console.warn("No parking lots found in response.");
        }
    } catch (error) {
        console.error("Error fetching parking data:", error);
    }
}

// Function to parse the specific response format
function parseParkingData(text) {
    // We look for the line starting with '5:[' and containing 'parkingLots'
    // The format is like: 5:["$","$L1c",null,{...}]
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.startsWith('5:') && line.includes('parkingLots')) {
            try {
                // Remove the '5:' prefix
                const jsonText = line.substring(2);
                // The structure is an array: ["$","$L1c",null,{...}]
                // We want the 4th element (index 3), which is the object containing 'parkingLots'
                // However, to safely parse, we can treat the whole thing as a JSON array
                const dataArray = JSON.parse(jsonText);
                if (dataArray && dataArray.length >= 4) {
                    const contentObj = dataArray[3];
                    if (contentObj && contentObj.parkingLots) {
                        // Map to required format
                        return contentObj.parkingLots.map(lot => ({
                            name: lot.name,
                            address: lot.address,
                            freeParkingNumber: lot.freeParkingNumber
                        }));
                    }
                }

            } catch (e) {
                console.error("Error parsing JSON line:", e);
            }
        }
    }
    return null;
}

// Function to update badge
async function updateBadge() {
    try {
        const data = await chrome.storage.local.get(['selectedLot', 'parkingLots']);
        if (data.selectedLot && data.parkingLots) {
            const lot = data.parkingLots.find(p => p.name === data.selectedLot);
            if (lot) {
                let color = '#4CAF50'; // Green >= 30
                if (lot.freeParkingNumber === 0) {
                    color = '#F44336'; // Red
                } else if (lot.freeParkingNumber < 20) {
                    color = '#FF9800'; // Orange
                } else if (lot.freeParkingNumber < 30) {
                    color = '#FFEB3B'; // Yellow
                }
                chrome.action.setBadgeText({ text: lot.freeParkingNumber.toString() });
                chrome.action.setBadgeBackgroundColor({ color: color });
            } else {
                chrome.action.setBadgeText({ text: '' });
            }
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    } catch (e) {
        console.error("Error updating badge", e);
    }
}

// History Handling
async function saveHistory() {
    try {
        const data = await chrome.storage.local.get(['selectedLot', 'parkingLots', 'lastSavedHistory']);
        const now = Date.now();
        const dateObj = new Date(now);
        const dayOfWeek = dateObj.getDay(); // 0-6
        const hour = dateObj.getHours(); // 0-23
        const minutesInsertInterval = 15 * 60 * 1000;

        // Check if 30 minutes have passed since last save
        let shouldSave = false;
        if (!data.lastSavedHistory) {
            shouldSave = true;
        } else {
            const timeDiff = now - data.lastSavedHistory;
            if (timeDiff >= minutesInsertInterval) {
                shouldSave = true;
            }
        }

        if (shouldSave) {
            if (data.selectedLot && data.parkingLots) {
                const lot = data.parkingLots.find(p => p.name === data.selectedLot);
                if (lot) {
                    const historyItem = {
                        timestamp: now,
                        spaces: lot.freeParkingNumber,
                        lotName: data.selectedLot
                    };

                    const key = `historyStats${dayOfWeek}`;
                    const storageResult = await chrome.storage.local.get([key]);
                    let dayStats = storageResult[key] || {};

                    // Ensure hour bucket exists
                    if (!dayStats[hour]) {
                        dayStats[hour] = [];
                    }

                    // Add new item
                    dayStats[hour].push(historyItem);

                    // Keep max 8 samples per hour
                    if (dayStats[hour].length > 8) {
                        dayStats[hour].shift(); // Remove oldest
                    }

                    await chrome.storage.local.set({
                        [key]: dayStats,
                        lastSavedHistory: now
                    });
                    console.log(`History saved for day ${dayOfWeek}, hour ${hour}:`, historyItem);
                }
            }
        }
    } catch (e) {
        console.error("Error saving history:", e);
    }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateBadge") {
        updateBadge();
    } else if (request.action === "refreshData") {
        fetchParkingData().then(() => {
            console.log("Refreshed via message");
        });
    }
});
