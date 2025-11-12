// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
// Style sheets
import "leaflet/dist/leaflet.css"; // supporting style for Leaflet
import "./style.css"; // student-controlled page style
// Fix missing marker images
import "./_leafletWorkaround.ts"; // fixes for missing Leaflet images
// Import our luck function
import luck from "./_luck.ts";

// --- GLOBAL STYLES / TAILWIND INJECTION ---
// Define a utility type to allow accessing the tailwind property on window safely
type WindowWithTailwind = Window & { tailwind: { config: object } };

// We must load the Tailwind CDN and configuration here since it was removed from index.html
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const tailwindScript = document.createElement("script");
  tailwindScript.src = "https://cdn.tailwindcss.com";
  document.head.appendChild(tailwindScript);

  // Set up configuration after Tailwind is loaded (using a listener for safety)
  tailwindScript.onload = () => {
    // FIX: Use double assertion to explicitly tell TypeScript that 'tailwind' exists on window after script load.
    ((window as unknown) as WindowWithTailwind).tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ["Inter", "sans-serif"],
          },
        },
      },
    };
  };
}

// --- CONSTANTS AND CONFIGURATION ---

// Our classroom location (fixed player location)
const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4; // Grid cell size (approx 10m)
const MAP_RADIUS = 50; // Total cells to render around the player (50x50 block)
const INTERACTION_RADIUS = 3; // Max distance in cells the player can interact
const INITIAL_SPAWN_PROBABILITY = 0.15;
const BASE_TOKEN_VALUES = [1, 2]; // Tokens can start as 1 or 2 (powers of 2)
const WIN_CONDITION = 16; // Game detects when player has a token of this value or higher

// --- GAME STATE ---

// State structure to hold the current value and Leaflet object for each cell
type CellState = {
  tokenValue: number | null; // null for no token, number for value
  rect: leaflet.Rectangle | null; // The Leaflet rectangle object
  marker: leaflet.Marker | null; // Stores the token marker directly
};

// Map to hold the state of all cells, keyed by "i,j"
const cellStates = new Map<string, CellState>();

// Player Inventory State
let heldToken: number | null = null; // null for empty, number for value

// --- UI ELEMENT SETUP ---

// Create basic UI elements (App Container, Map, Status Panel)
const appContainer = document.createElement("div");
appContainer.className = "app-container";
document.body.append(appContainer);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
appContainer.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
appContainer.append(statusPanelDiv);

// --- MAP INITIALIZATION ---

const map = leaflet.map(mapDiv, {
  center: CLASSROOM_LATLNG,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: true, // Allow scrolling to see edges of the rendered area
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player (fixed location)
const playerMarker = leaflet.marker(CLASSROOM_LATLNG);
playerMarker.bindTooltip("That's you!", {
  permanent: true,
  direction: "right",
});
playerMarker.addTo(map);

// --- GAME MECHANICS AND UTILITIES ---

/**
 * Deterministically calculates the initial token value for a cell based on its coordinates.
 * This ensures consistency across page loads.
 * @param i The grid x-coordinate.
 * @param j The grid y-coordinate.
 * @returns The token value (1 or 2) or null if no token spawns.
 */
function getInitialTokenValue(i: number, j: number): number | null {
  const spawnSituation = [i, j, "initial_spawn_d3a"].toString();
  if (luck(spawnSituation) < INITIAL_SPAWN_PROBABILITY) {
    // Deterministically choose a base value (1 or 2)
    const valueChoiceSituation = [i, j, "value_choice_d3a"].toString();
    const valueIndex = Math.floor(
      luck(valueChoiceSituation) * BASE_TOKEN_VALUES.length,
    );
    return BASE_TOKEN_VALUES[valueIndex];
  }
  return null;
}

/**
 * Creates a DivIcon for the cell content (visible token value or empty indicator).
 * @param value The token value to display, or null.
 * @returns A Leaflet DivIcon.
 */
function getCellDivIcon(value: number | null): leaflet.DivIcon {
  const color = value ? `hsl(${Math.log2(value) * 60}, 80%, 30%)` : "#ccc";
  const displayValue = value ? value.toString() : "";

  // Use a DivIcon to display the token value constantly inside the cell
  const html = `
    <div style="
      width: 100%; height: 100%;
      display: flex; justify-content: center; align-items: center;
      background-color: ${value ? "rgba(255, 255, 255, 0.8)" : "transparent"};
      border: 2px solid ${color};
      border-radius: 6px;
      font-weight: bold;
      color: ${color};
      font-size: 14px;
      user-select: none;
      box-shadow: 0 0 5px rgba(0,0,0,0.2);
      transform: scale(0.8);
    ">
      ${displayValue}
    </div>
  `;

  return leaflet.divIcon({
    className: "cell-content-icon",
    html: html,
    // Icon size set to be slightly smaller than the cell size for a nice fit
    iconSize: [40, 40],
    iconAnchor: [20, 20], // Anchor at the center
  });
}

/**
 * Renders or updates a cell on the map based on its current state.
 * @param i The grid x-coordinate.
 * @param j The grid y-coordinate.
 */
function drawCell(i: number, j: number): void {
  const id = `${i},${j}`;
  // Used const as cellState object itself is not reassigned
  const cellState = cellStates.get(id);

  if (!cellState) return;

  // Leaflet coordinates use [lat, lng], which maps to [j, i] in our grid system
  const origin = CLASSROOM_LATLNG;
  const bounds = leaflet.latLngBounds([
    [origin.lat + j * TILE_DEGREES, origin.lng + i * TILE_DEGREES],
    [origin.lat + (j + 1) * TILE_DEGREES, origin.lng + (i + 1) * TILE_DEGREES],
  ]);

  const isInteractable = Math.abs(i) <= INTERACTION_RADIUS &&
    Math.abs(j) <= INTERACTION_RADIUS;
  const cellColor = cellState.tokenValue
    ? `hsl(${Math.log2(cellState.tokenValue) * 60}, 80%, 50%)` // Dynamic color based on value
    : isInteractable
    ? "rgba(70, 130, 180, 0.1)" // Light steel blue if empty and interactable
    : "rgba(0, 0, 0, 0.05)"; // Light grey if outside range

  const rectOptions: leaflet.PolylineOptions = {
    color: isInteractable ? "#4682b4" : "#333", // Steel Blue or Dark Grey
    weight: isInteractable ? 2 : 0.5,
    opacity: 1,
    fillOpacity: cellState.tokenValue ? 0.5 : (isInteractable ? 0.1 : 0), // Tokens are more opaque
    fillColor: cellColor,
    className: isInteractable ? "interactable-cell" : "non-interactable-cell",
  };

  if (cellState.rect) {
    // Update existing rectangle style
    cellState.rect.setStyle(rectOptions);

    // Remove existing marker
    if (cellState.marker) {
      map.removeLayer(cellState.marker);
      cellState.marker = null;
    }
    // Only add a visible marker if there's a token
    if (cellState.tokenValue !== null) {
      const center = bounds.getCenter();
      const marker = leaflet.marker(center, {
        icon: getCellDivIcon(cellState.tokenValue),
        interactive: false,
      });
      marker.addTo(map);
      // Store marker directly in state
      cellState.marker = marker;
    }
  } else {
    // Create new rectangle
    const rect = leaflet.rectangle(bounds, rectOptions);
    rect.addTo(map);
    cellState.rect = rect;

    // Set up click handler
    rect.on("click", () => handleCellClick(i, j));

    // Initial marker placement
    if (cellState.tokenValue !== null) {
      const center = bounds.getCenter();
      const marker = leaflet.marker(center, {
        icon: getCellDivIcon(cellState.tokenValue),
        interactive: false,
      });
      marker.addTo(map);
      // Store marker directly in state
      cellState.marker = marker;
    }
  }

  // Update the map state
  cellStates.set(id, cellState);
}

/**
 * Handles the game logic when a cell is clicked.
 * @param i The grid x-coordinate.
 * @param j The grid y-coordinate.
 */
function handleCellClick(i: number, j: number): void {
  const id = `${i},${j}`;
  const cellState = cellStates.get(id);

  if (!cellState) return;

  // 1. Check Interaction Radius
  const distance = Math.max(Math.abs(i), Math.abs(j));
  if (distance > INTERACTION_RADIUS) {
    showMessage(
      `That cell (${i},${j}) is too far away. You can only interact within ${INTERACTION_RADIUS} cells.`,
      "error",
    );
    return;
  }

  const cellTokenValue = cellState.tokenValue;
  const isCellEmpty = cellTokenValue === null;
  const isPlayerHolding = heldToken !== null;

  if (!isPlayerHolding && !isCellEmpty) {
    // --- PICKUP ---
    heldToken = cellTokenValue;
    cellState.tokenValue = null;
    showMessage(`Picked up a token worth ${heldToken}!`);
  } else if (isPlayerHolding && !isCellEmpty) {
    // --- CRAFTING ---
    if (heldToken === cellTokenValue) {
      const newTokenValue = heldToken * 2;
      heldToken = newTokenValue;
      cellState.tokenValue = null; // Token from cell is consumed
      showMessage(`CRAFTED! New token value: ${newTokenValue}.`);

      // 4. Game detects sufficient value
      if (heldToken >= WIN_CONDITION) {
        showMessage(
          `CONGRATULATIONS! You crafted a winning token of value ${heldToken}!`,
          "win",
        );
      }
    } else {
      showMessage(
        `Cannot craft. The cell token (${cellTokenValue}) must equal your held token (${heldToken}).`,
        "error",
      );
      return; // Do not redraw if crafting failed
    }
  } else if (isPlayerHolding && isCellEmpty) {
    // --- PLACEMENT ---
    cellState.tokenValue = heldToken;
    heldToken = null;
    showMessage(`Placed a token of value ${cellState.tokenValue}.`);
  } else if (!isPlayerHolding && isCellEmpty) {
    // --- DO NOTHING ---
    showMessage("This cell is empty, and you are not holding a token.", "info");
    return; // Do not redraw, nothing changed
  }

  // Update UI and map
  drawCell(i, j); // Redraw the changed cell
  updateStatusPanel();
}

/**
 * Updates the inventory display and win condition message.
 */
function updateStatusPanel(): void {
  const heldText = heldToken !== null
    ? `Holding: 🪙 Level ${heldToken}`
    : `Holding: 🚫 Empty`;

  const winStatus = heldToken !== null && heldToken >= WIN_CONDITION
    ? '<span class="text-green-600 font-bold ml-4">WIN DETECTED!</span>'
    : "";

  statusPanelDiv.innerHTML = `
    <div class="status-box flex justify-center items-center space-x-4">
        <p class="p-2 bg-gray-100 rounded-lg shadow-inner">${heldText}</p>
        ${winStatus}
    </div>
  `;
}

/**
 * Shows a temporary message to the player instead of using alert().
 * @param message The message to display.
 * @param type 'info', 'error', or 'win'.
 */
function showMessage(
  message: string,
  type: "info" | "error" | "win" = "info",
): void {
  const msgDiv = document.createElement("div");
  msgDiv.className =
    `message-box ${type} absolute top-0 left-1/2 transform -translate-x-1/2 mt-2 z-[1000] rounded-lg shadow-xl p-3`;
  msgDiv.textContent = message;

  // Get the status panel's direct parent (the body)
  const parent = statusPanelDiv.parentElement || document.body;

  // Remove existing temporary messages to ensure only one is shown
  parent.querySelectorAll(".message-box").forEach((el) => el.remove());

  parent.appendChild(msgDiv);

  setTimeout(() => {
    // Add a class to fade out before removing
    msgDiv.style.opacity = "0";
    setTimeout(() => {
      msgDiv.remove();
    }, 500); // Wait for CSS transition to finish
  }, type === "win" ? 5000 : 2500);
}

// --- GAME INITIALIZATION ---

/**
 * Initializes the entire map grid and the game state.
 */
function initializeGame(): void {
  // 1. Populate initial deterministic state and draw cells
  for (let i = -MAP_RADIUS; i <= MAP_RADIUS; i++) {
    for (let j = -MAP_RADIUS; j <= MAP_RADIUS; j++) {
      const id = `${i},${j}`;
      const initialValue = getInitialTokenValue(i, j);

      // Create initial state entry
      cellStates.set(id, {
        tokenValue: initialValue,
        rect: null, // Leaflet object will be created in drawCell
        marker: null, // Initial marker state
      });
      // Initial draw
      drawCell(i, j);
    }
  }

  // 2. Initial status panel update
  updateStatusPanel();
}

// Wait for the map to be ready before initializing the game logic
map.whenReady(() => {
  // Center the map view on the player's fixed location
  map.setView(CLASSROOM_LATLNG, GAMEPLAY_ZOOM_LEVEL);
  initializeGame();
});

// A simple export to satisfy the module requirement, even if it's not used externally
export {};
