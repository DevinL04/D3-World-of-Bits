// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css"; // supporting style for Leaflet
import "./style.css"; // custom page style

// Fix missing marker images
import "./_leafletWorkaround.ts";

// Import our luck function
import luck from "./_luck.ts";

// --- Type Definitions ---

interface Cell {
  i: number;
  j: number;
  tokenValue: number; // 0 if empty, 1, 2, 4, 8, etc.
  rect?: leaflet.Rectangle;
  marker?: leaflet.Marker;
}

// --- Game Configuration & Constants ---

// Our classroom location (fixed player location)
const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);
const TILE_DEGREES = 1e-4; // Grid cell size (approx. 10m x 10m)
const GAMEPLAY_ZOOM_LEVEL = 19;
const RENDER_RADIUS = 20; // Number of cells to render around the player to cover the screen
const INITIAL_SPAWN_PROBABILITY = 0.1;
const INTERACTION_RADIUS = 3; // Max distance (in cells) player can interact with

// --- Global State ---

// Map to store Leaflet layer objects (rectangles) for the grid
const cellLayers: Map<string, Cell> = new Map();
let heldTokenValue: number = 0; // Value of the token the player holds (0 if empty)

// --- Utility Functions ---

/** Converts i, j coordinates to a unique string key. */
function getCellKey(i: number, j: number): string {
  return `${i},${j}`;
}

/** Converts a Leaflet LatLng object into grid coordinates {i, j}. */
function _latLngToCell(latLng: leaflet.LatLng): { i: number; j: number } {
  const origin = CLASSROOM_LATLNG;
  const i = Math.floor((latLng.lat - origin.lat) / TILE_DEGREES);
  const j = Math.floor((latLng.lng - origin.lng) / TILE_DEGREES);
  return { i, j };
}

/** Calculates the latitude/longitude bounds for a given cell. */
function getCellBounds(i: number, j: number): leaflet.LatLngBounds {
  const origin = CLASSROOM_LATLNG;
  return leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [
      origin.lat + (i + 1) * TILE_DEGREES,
      origin.lng + (j + 1) * TILE_DEGREES,
    ],
  ]);
}

/** Determines the initial token value for a cell using deterministic luck. */
function getInitialTokenValue(i: number, j: number): number {
  const seed = getCellKey(i, j) + "initial-spawn-v1";
  const spawnChance = luck(seed);

  if (spawnChance < INITIAL_SPAWN_PROBABILITY) {
    // 90% chance of spawning a 1, 10% chance of spawning a 2
    const valueSeed = getCellKey(i, j) + "initial-value-v1";
    return luck(valueSeed) < 0.9 ? 1 : 2;
  }
  return 0; // No token
}

/** Checks if the cell is within the interaction radius of the fixed player location (0, 0). */
function isCellNearby(i: number, j: number): boolean {
  // Since the player is fixed at the origin cell (0, 0), proximity is measured from there.
  return Math.abs(i) <= INTERACTION_RADIUS && Math.abs(j) <= INTERACTION_RADIUS;
}

// --- Map and Grid Rendering ---

// Create basic UI elements
const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
document.body.append(statusPanelDiv);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

// Create the map
const map = leaflet.map(mapDiv, {
  center: CLASSROOM_LATLNG,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false, // Disable map scrolling/zooming to fix the game area
  scrollWheelZoom: false,
  dragging: false, // Prevent dragging
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add the player marker
const playerIcon = leaflet.divIcon({
  className: "player-icon",
  html: "&#128099;", // Walking shoe emoji
  iconSize: [30, 30],
});
leaflet.marker(CLASSROOM_LATLNG, { icon: playerIcon }).addTo(map);

/** Updates the status panel with the player's current inventory state. */
function updateStatusPanel() {
  let statusHTML = `<div class="status-content">`;

  if (heldTokenValue > 0) {
    statusHTML +=
      `Held Token: <span class="held-token-value token-value-${heldTokenValue}">${heldTokenValue}</span>`;
  } else {
    statusHTML += `Held Token: None (Max 1)`;
  }

  // Detect crafting victory condition (e.g., 8 or 16)
  if (heldTokenValue >= 8) {
    statusHTML +=
      `<div class="status-victory">SUCCESS! Token value of ${heldTokenValue} achieved!</div>`;
  }

  statusHTML += `</div>`;
  statusPanelDiv.innerHTML = statusHTML;
}

/** Updates the visual representation (marker) of a cell's token value. */
function updateCellMarker(cell: Cell) {
  // Remove existing marker if present
  if (cell.marker) {
    cell.marker.remove();
    // FIX for TS2412: Use 'delete' to remove the optional property
    // instead of assigning 'undefined' when in strict mode.
    delete cell.marker;
  }

  if (cell.tokenValue > 0) {
    // Calculate the center of the cell to place the marker
    const bounds = getCellBounds(cell.i, cell.j);
    const center = bounds.getCenter();

    // Custom DivIcon to display the token value as text
    const tokenIcon = leaflet.divIcon({
      className: `token-icon token-value-${cell.tokenValue}`,
      html: `<div>${cell.tokenValue}</div>`,
      iconSize: [40, 40],
    });

    // Create and add the marker to the map
    cell.marker = leaflet.marker(center, { icon: tokenIcon }).addTo(map);
  }
}

/** Handles the game mechanics when a cell is clicked. */
function handleCellClick(cell: Cell) {
  if (!isCellNearby(cell.i, cell.j)) {
    console.log(`Cell ${cell.i}, ${cell.j} is too far to interact.`);
    return;
  }

  const groundValue = cell.tokenValue;
  const held = heldTokenValue;

  if (held > 0) {
    // --- Scenario 1: Crafting or Placing ---
    if (groundValue > 0) {
      if (held === groundValue) {
        // CRAFTING: Tokens are equal, merge them
        heldTokenValue = held * 2;
        cell.tokenValue = 0; // Remove token from cell
        console.log(`Crafted ${held} + ${groundValue} = ${heldTokenValue}`);
      } else {
        // Do nothing if tokens are present but not equal (cannot merge)
        console.log(
          `Cannot craft: Held value ${held} does not match ground value ${groundValue}.`,
        );
        return;
      }
    } else {
      // PLACEMENT: Place held token onto empty cell
      cell.tokenValue = held;
      heldTokenValue = 0; // Inventory is now empty
      console.log(`Placed token value ${cell.tokenValue} onto cell.`);
    }
  } else {
    // --- Scenario 2: Picking Up ---
    if (groundValue > 0) {
      // PICK UP: Token on ground, inventory is empty
      heldTokenValue = groundValue;
      cell.tokenValue = 0; // Remove token from cell
      console.log(`Picked up token value ${heldTokenValue}.`);
    } else {
      // Do nothing if cell is empty and inventory is empty
      console.log(`Cell is empty and no token is held.`);
      return;
    }
  }

  // Update visuals and status after interaction
  updateCellMarker(cell);
  updateStatusPanel();
  updateInteractionHighlights();
}

/** Renders or updates a single cell's boundary, state, and interaction. */
function renderCell(i: number, j: number): void {
  const key = getCellKey(i, j);
  const bounds = getCellBounds(i, j);

  // 1. Initialize Cell Data State (Only on first run)
  if (!cellLayers.has(key)) {
    const tokenValue = getInitialTokenValue(i, j);
    const cell: Cell = { i, j, tokenValue };
    cellLayers.set(key, cell);

    // 2. Render Cell Boundary
    cell.rect = leaflet.rectangle(bounds, {
      fillOpacity: 0.1,
      weight: 1,
      color: "#CCC",
      fillColor: "#FFF",
    });
    cell.rect.addTo(map);

    // 3. Attach Click Handler
    cell.rect.on("click", () => handleCellClick(cell));

    // 4. Render Initial Token Marker
    updateCellMarker(cell);
  }
}

/** Toggles the visual highlight for nearby, interactive cells. */
function updateInteractionHighlights() {
  cellLayers.forEach((cell) => {
    if (cell.rect) {
      if (isCellNearby(cell.i, cell.j)) {
        // Add highlight class
        cell.rect.getElement()?.classList.add("cell-interactive");
      } else {
        // Remove highlight class
        cell.rect.getElement()?.classList.remove("cell-interactive");
      }
    }
  });
}

/** Main rendering loop to draw the initial grid (map edge to edge). */
function renderMapGrid() {
  for (let i = -RENDER_RADIUS; i <= RENDER_RADIUS; i++) {
    for (let j = -RENDER_RADIUS; j <= RENDER_RADIUS; j++) {
      renderCell(i, j);
    }
  }
}

// Initial Setup Calls
renderMapGrid();
updateInteractionHighlights();
updateStatusPanel();
