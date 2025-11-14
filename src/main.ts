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

const INITIAL_PLAYER_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);
const NULL_ISLAND_LATLNG = leaflet.latLng(0, 0); // Anchor for the earth-spanning grid

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4; // Grid cell size (approx 10m)
const INTERACTION_RADIUS = 3; // Max distance in cells the player can interact
const INITIAL_SPAWN_PROBABILITY = 0.15;
const BASE_TOKEN_VALUES = [1, 2]; // Tokens can start as 1 or 2 (powers of 2)
const WIN_CONDITION = 16384;

// --- TYPES AND COORDINATE UTILITIES ---

type GridCell = { i: number; j: number };

/**
 * Converts a continuous LatLng coordinate to its discrete grid cell identifier (i, j).
 */
function latLngToGridCell(latlng: leaflet.LatLng): GridCell {
  const i = Math.floor((latlng.lng - NULL_ISLAND_LATLNG.lng) / TILE_DEGREES);
  const j = Math.floor((latlng.lat - NULL_ISLAND_LATLNG.lat) / TILE_DEGREES);
  return { i, j };
}

/**
 * Converts a grid cell identifier (i, j) back to its geographical bounds.
 */
function gridCellToBounds(cell: GridCell): leaflet.LatLngBounds {
  const latStart = NULL_ISLAND_LATLNG.lat + cell.j * TILE_DEGREES;
  const latEnd = NULL_ISLAND_LATLNG.lat + (cell.j + 1) * TILE_DEGREES;
  const lngStart = NULL_ISLAND_LATLNG.lng + cell.i * TILE_DEGREES;
  const lngEnd = NULL_ISLAND_LATLNG.lng + (cell.i + 1) * TILE_DEGREES;

  return leaflet.latLngBounds(
    [latStart, lngStart],
    [latEnd, lngEnd],
  );
}

// --- GAME STATE (FLYWEIGHT & MEMENTO) ---

// 1. Flyweight Map: Only holds state for **visible** cells (for rendering).
type CellState = {
  tokenValue: number | null; // null for no token, number for value
  rect: leaflet.Rectangle | null;
  marker: leaflet.Marker | null;
};
const cellStates = new Map<string, CellState>();

// 2. Memento Map: Holds the **modified** state of tokens across the entire grid (for persistence).
// A cell is only stored here if its state is different from its initial deterministic spawn.
// Key: "i,j" string, Value: Token value (number) or null if the token was taken/cleared.
const modifiedCellStates = new Map<string, number | null>();

// Player Location State
let playerLatLng = INITIAL_PLAYER_LATLNG;
let heldToken: number | null = null;

// --- UI ELEMENT SETUP ---

// Create basic UI elements (App Container, Map, Status Panel)
const appContainer = document.createElement("div");
appContainer.className = "app-container";
document.body.append(appContainer);

const controlPanelDiv = document.createElement("div");
controlPanelDiv.id = "controlPanel";
controlPanelDiv.className =
  "p-3 bg-white shadow-xl z-[1000] sticky top-0 flex flex-col items-center justify-center space-y-2";
appContainer.append(controlPanelDiv);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
appContainer.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
appContainer.append(statusPanelDiv);

// --- MAP INITIALIZATION ---

const map = leaflet.map(mapDiv, {
  center: INITIAL_PLAYER_LATLNG,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL - 2,
  maxZoom: GAMEPLAY_ZOOM_LEVEL + 2,
  zoomControl: true,
  // Disable map interactions so movement is purely based on controls/buttons
  dragging: false,
  touchZoom: false,
  doubleClickZoom: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(playerLatLng);
playerMarker.bindTooltip("That's you!", {
  permanent: true,
  direction: "right",
});
playerMarker.addTo(map);

// --- GAME MECHANICS AND UTILITIES ---

/**
 * Deterministically calculates the initial token value for a cell based on its coordinates.
 * This acts as the *source* for the Flyweight tokens.
 * @param i The grid x-coordinate.
 * @param j The grid y-coordinate.
 * @returns The token value (1 or 2) or null if no token spawns.
 */
function getInitialTokenValue(i: number, j: number): number | null {
  const spawnSituation = [i, j, "initial_spawn_d3b"].toString();
  if (luck(spawnSituation) < INITIAL_SPAWN_PROBABILITY) {
    const valueChoiceSituation = [i, j, "value_choice_d3b"].toString();
    const valueIndex = Math.floor(
      luck(valueChoiceSituation) * BASE_TOKEN_VALUES.length,
    );
    return BASE_TOKEN_VALUES[valueIndex];
  }
  return null;
}

/**
 * Creates a DivIcon for the cell content.
 */
function getCellDivIcon(value: number | null): leaflet.DivIcon {
  const color = value ? `hsl(${Math.log2(value) * 60}, 80%, 30%)` : "#ccc";
  const displayValue = value ? value.toString() : "";

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
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

/**
 * Renders or updates a cell on the map based on its current state.
 */
function drawCell(i: number, j: number): void {
  const id = `${i},${j}`;
  const cellState = cellStates.get(id);

  if (!cellState) return;

  const bounds = gridCellToBounds({ i, j });

  const playerCell = latLngToGridCell(playerLatLng);
  const iDelta = Math.abs(i - playerCell.i);
  const jDelta = Math.abs(j - playerCell.j);
  const distance = Math.max(iDelta, jDelta);

  const isInteractable = distance <= INTERACTION_RADIUS;
  const cellColor = cellState.tokenValue
    ? `hsl(${Math.log2(cellState.tokenValue) * 60}, 80%, 50%)`
    : isInteractable
    ? "rgba(70, 130, 180, 0.1)"
    : "rgba(0, 0, 0, 0.05)";

  const rectOptions: leaflet.PolylineOptions = {
    color: isInteractable ? "#4682b4" : "#333",
    weight: isInteractable ? 2 : 0.5,
    opacity: 1,
    fillOpacity: cellState.tokenValue ? 0.5 : (isInteractable ? 0.1 : 0),
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
 * Handles the game logic when a cell is clicked, updating the Memento Map for persistence.
 */
function handleCellClick(i: number, j: number): void {
  const id = `${i},${j}`;
  const cellState = cellStates.get(id);

  if (!cellState) return;

  // 1. Check Interaction Radius
  const playerCell = latLngToGridCell(playerLatLng);
  const iDelta = Math.abs(i - playerCell.i);
  const jDelta = Math.abs(j - playerCell.j);
  const distance = Math.max(iDelta, jDelta);

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
    // D3.c Memento: Mark the cell as permanently empty in the persistent map
    modifiedCellStates.set(id, null);
    showMessage(`Picked up a token worth ${heldToken}!`);
  } else if (isPlayerHolding && !isCellEmpty) {
    // --- CRAFTING ---
    if (heldToken === cellTokenValue) {
      const newTokenValue = heldToken * 2;
      heldToken = newTokenValue;
      cellState.tokenValue = null; // Token from cell is consumed
      // D3.c Memento: Mark the consumed cell as permanently empty
      modifiedCellStates.set(id, null);
      showMessage(`CRAFTED! New token value: ${newTokenValue}.`);

      // Game detects sufficient value
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
      return;
    }
  } else if (isPlayerHolding && isCellEmpty) {
    // --- PLACEMENT ---
    cellState.tokenValue = heldToken;
    heldToken = null;
    // D3.c Memento: Store the new token value in the persistent map
    modifiedCellStates.set(id, cellState.tokenValue);
    showMessage(`Placed a token of value ${cellState.tokenValue}.`);
  } else if (!isPlayerHolding && isCellEmpty) {
    // --- DO NOTHING ---
    showMessage("This cell is empty, and you are not holding a token.", "info");
    return;
  }

  // Update UI and map
  drawCell(i, j);
  updateStatusPanel();
}

/**
 * Updates the inventory display and win condition message.
 */
function updateStatusPanel(): void {
  const heldText = heldToken !== null
    ? `Holding: 🪙 Level ${heldToken}`
    : `Holding: 🚫 Empty`;

  const playerCell = latLngToGridCell(playerLatLng);
  const locationText = `Location: (${playerCell.i}, ${playerCell.j})`;

  const winStatus = heldToken !== null && heldToken >= WIN_CONDITION
    ? '<span class="text-green-600 font-bold ml-4">VICTORY ACHIEVED!</span>'
    : "";

  statusPanelDiv.innerHTML = `
    <div class="status-box p-4 bg-gray-50 rounded-lg shadow-lg">
        <div class="flex flex-wrap justify-between items-center text-sm md:text-base">
            <p class="font-semibold text-blue-800">${locationText}</p>
            <p class="font-bold text-gray-700">${heldText}</p>
            ${winStatus}
        </div>
    </div>
  `;
}

/**
 * Shows a temporary message to the player instead of using alert().
 */
function showMessage(
  message: string,
  type: "info" | "error" | "win" = "info",
): void {
  const msgDiv = document.createElement("div");
  const colorClass = {
    "info": "bg-blue-500",
    "error": "bg-red-500",
    "win": "bg-green-500",
  }[type];
  const icon = {
    "info": "ⓘ",
    "error": "🛑",
    "win": "🏆",
  }[type];

  msgDiv.className =
    `message-box ${type} absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] rounded-lg shadow-xl p-3 text-white font-semibold flex items-center space-x-2 ${colorClass} opacity-100 transition-opacity duration-500`;
  msgDiv.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

  const parent = statusPanelDiv.parentElement || document.body;

  parent.querySelectorAll(".message-box").forEach((el) => el.remove());

  parent.appendChild(msgDiv);

  setTimeout(() => {
    msgDiv.style.opacity = "0";
    setTimeout(() => {
      msgDiv.remove();
    }, 500);
  }, type === "win" ? 5000 : 2500);
}

/**
 * Updates the player's position and map marker, and pans the map.
 */
function updatePlayerPosition(newLatLng: leaflet.LatLng): void {
  playerLatLng = newLatLng;

  playerMarker.setLatLng(playerLatLng);

  // Pan the map to the new position (this triggers renderVisibleCells via 'moveend')
  map.panTo(playerLatLng);

  updateStatusPanel();
}

/**
 * Calculates the new LatLng based on the current player position and a direction
 * and calls updatePlayerPosition.
 */
function movePlayer(direction: "north" | "south" | "east" | "west"): void {
  let latDelta = 0;
  let lngDelta = 0;

  switch (direction) {
    case "north":
      latDelta = TILE_DEGREES;
      break;
    case "south":
      latDelta = -TILE_DEGREES;
      break;
    case "east":
      lngDelta = TILE_DEGREES;
      break;
    case "west":
      lngDelta = -TILE_DEGREES;
      break;
  }

  const newLat = playerLatLng.lat + latDelta;
  const newLng = playerLatLng.lng + lngDelta;
  const newLatLng = leaflet.latLng(newLat, newLng);

  updatePlayerPosition(newLatLng);
}

/**
 * D3.c: Renders visible cells, implementing the Memento pattern check.
 */
function renderVisibleCells(): void {
  // 1. Cleanup: Remove all old cell layers from the map and clear the Flyweight state.
  for (const [_id, state] of cellStates.entries()) {
    if (state.rect) map.removeLayer(state.rect);
    if (state.marker) map.removeLayer(state.marker);
  }
  cellStates.clear();

  // 2. Determine Map Bounds
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const startCell = latLngToGridCell(sw);
  const endCell = latLngToGridCell(ne);

  const i_min = startCell.i - 1;
  const i_max = endCell.i + 1;
  const j_min = startCell.j - 1;
  const j_max = endCell.j + 1;

  // 3. Spawn and Draw Visible Cells
  for (let i = i_min; i <= i_max; i++) {
    for (let j = j_min; j <= j_max; j++) {
      const id = `${i},${j}`;

      let tokenValue: number | null;

      // D3.c Memento Pattern Check (Restoration)
      if (modifiedCellStates.has(id)) {
        // RESTORE: Use the modified state from the Memento map
        tokenValue = modifiedCellStates.get(id) as (number | null);
      } else {
        // FALLBACK: Use the deterministic initial state (Flyweight source)
        tokenValue = getInitialTokenValue(i, j);
      }

      // 3b. Initialize state (Flyweight) and draw
      cellStates.set(id, {
        tokenValue: tokenValue,
        rect: null, // will be set by drawCell
        marker: null, // will be set by drawCell
      });

      drawCell(i, j);
    }
  }
  updateStatusPanel();
}

/**
 * Creates and attaches the directional buttons to the control panel.
 */
function setupControls(): void {
  const buttonClass =
    "p-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-full shadow-lg transition duration-200 w-12 h-12 flex items-center justify-center text-xl";

  controlPanelDiv.innerHTML = `
        <div class="grid grid-cols-3 grid-rows-3 gap-1 md:gap-2">
            <div class="col-start-2 row-start-1">
                <button id="move-north" class="${buttonClass}">↑</button>
            </div>
            <div class="col-start-1 row-start-2">
                <button id="move-west" class="${buttonClass}">←</button>
            </div>
            <div class="col-start-3 row-start-2">
                <button id="move-east" class="${buttonClass}">→</button>
            </div>
            <div class="col-start-2 row-start-3">
                <button id="move-south" class="${buttonClass}">↓</button>
            </div>
        </div>
        <p class="text-xs text-gray-500 mt-2">Use buttons or arrow/WASD keys to move.</p>
    `;

  // Attach event listeners
  document.getElementById("move-north")?.addEventListener(
    "click",
    () => movePlayer("north"),
  );
  document.getElementById("move-south")?.addEventListener(
    "click",
    () => movePlayer("south"),
  );
  document.getElementById("move-east")?.addEventListener(
    "click",
    () => movePlayer("east"),
  );
  document.getElementById("move-west")?.addEventListener(
    "click",
    () => movePlayer("west"),
  );

  // Add keyboard controls
  document.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        movePlayer("north");
        break;
      case "ArrowDown":
      case "s":
      case "S":
        movePlayer("south");
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        movePlayer("west");
        break;
      case "ArrowRight":
      case "d":
      case "D":
        movePlayer("east");
        break;
    }
  });
}

/**
 * Initializes the game by setting up the map events and controls.
 */
function initializeGame(): void {
  setupControls();

  // The 'moveend' event triggers the memoryless re-render
  map.on("moveend", renderVisibleCells);

  updateStatusPanel();

  // Render initial cells
  renderVisibleCells();
}

// Wait for the map to be ready before initializing the game logic
map.whenReady(() => {
  map.setView(playerLatLng, GAMEPLAY_ZOOM_LEVEL);
  initializeGame();
});

export {};
