const fs = require('fs');

function parseParkingData(text) {
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.startsWith('5:') && line.includes('parkingLots')) {
            try {
                const jsonText = line.substring(2);
                const dataArray = JSON.parse(jsonText);
                if (dataArray && dataArray.length >= 4) {
                    const contentObj = dataArray[3];
                    if (contentObj && contentObj.parkingLots) {
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

try {
    const exampleContent = fs.readFileSync('../res.json', 'utf8');
    const result = parseParkingData(exampleContent);
    if (result && result.length > 0) {
        console.log("SUCCESS: Parsed " + result.length + " parking lots.");
        console.log("First item:", result[0]);
    } else {
        console.error("FAILURE: Could not parse parking lots.");
    }
} catch (e) {
    console.error("Error reading file:", e);
}
