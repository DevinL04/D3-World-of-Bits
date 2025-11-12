// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css"; // supporting style for Leaflet
import "./style.css"; // custom page style

// Fix missing marker images
import "./_leafletWorkaround.ts";

// Import our luck function (needed for later use, but imported now)
import _luck from "./_luck.ts";

// --- Game Configuration & Constants ---

// Our classroom location (fixed player location)
const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);
const TILE_DEGREES = 1e-4; // Grid cell size (approx. 10m x 10m)
const GAMEPLAY_ZOOM_LEVEL = 19;
const RENDER_RADIUS = 20; // Number of cells to render around the player to cover the screen

// --- Global State ---

// Map to store Leaflet layer objects (rectangles) for the grid
const cellLayers: Map<string, leaflet.Rectangle> = new Map();

// --- Utility Functions ---

/** Converts i, j coordinates to a unique string key. */
function getCellKey(i: number, j: number): string {
  return `${i},${j}`;
}

/** Converts a Leaflet LatLng object into grid coordinates {i, j}. (Not used yet, but ready) */
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

/** Renders a single cell's boundary. */
function renderCell(i: number, j: number): void {
  const key = getCellKey(i, j);
  const bounds = getCellBounds(i, j);

  // Render/Update Cell Boundary
  const rect = leaflet.rectangle(bounds, {
    fillOpacity: 0.1,
    weight: 1,
    color: "#CCC",
    fillColor: "#FFF",
  });
  rect.addTo(map);
  cellLayers.set(key, rect);

  // Placeholder: Click handler will be added in Push 3
  rect.on("click", () => console.log(`Clicked cell ${i}, ${j}`));
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
statusPanelDiv.innerHTML = "Game Loading...";
renderMapGrid();
