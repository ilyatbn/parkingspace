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
        const data = await chrome.storage.local.get(['selectedLot', 'parkingLots', 'parkingHistory', 'lastSavedHistory']);
        const now = Date.now();
        const thirtyMinutes = 30 * 60 * 1000;

        // Check if 30 minutes have passed since last save, or if never saved
        // We also want to align roughly to xx:00 and xx:30 if possible, but the requirement basically implies 
        // "store ... every 30 minutes". The simplest robust way is just checking the interval.
        // User said: "specifically on xx:00 and xx:30". 
        // To strictly follow "specifically on xx:00 and xx:30", we might need to check the current minute?
        // But the user also said "if it doesnt exist, update the data... this will also fix any issues".
        // Let's stick to the interval check as primary, but maybe we can just save if it's been > 30 mins.
        // Or strictly: if (now - lastSaved >= 30mins)

        // Let's implement the interval check as requested in the second prompt:
        // "check if its been more than 30 minutes since lastSavedHistory"

        let shouldSave = false;
        if (!data.lastSavedHistory) {
            shouldSave = true;
        } else {
            const timeDiff = now - data.lastSavedHistory;
            if (timeDiff >= thirtyMinutes) {
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

                    let history = data.parkingHistory || [];
                    history.push(historyItem);

                    // Limit to 1500
                    if (history.length > 1500) {
                        history.shift();
                    }

                    await chrome.storage.local.set({
                        parkingHistory: history,
                        lastSavedHistory: now
                    });
                    console.log("History saved:", historyItem);
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
