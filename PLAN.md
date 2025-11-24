# D3: World of Bits — Project Plan

# Game Design Vision

Location-based crafting game where players use the map to find and collect tokens from nearby grid cells. These tokens can be crafted with tokens of the same value to double their worth.

# Technologies

- TypeScript for most game code; minimal HTML; all CSS in `style.css`
- Deno + Vite for building
- GitHub Actions + GitHub Pages for deployment

# Assignments

## **D3.a — Core Mechanics**

**Goal:** Build map UI with Leaflet and allow basic token collection + crafting.

- [x] Copy `main.ts` to `reference.ts`
- [x] Delete everything in `main.ts`
- [x] Basic Leaflet map rendering
- [x] Removed random caches, spawns, and popups
- [x] Larger grid rendering
- [x] UI cleanup
- [x] Draw player's location
- [x] Draw rectangle for a single cell
- [x] Loop-based full grid rendering
- [x] Token spawn
- [x] Visual token rendering
- [x] Reskin tokens & improved UI positioning
- [x] Deterministic luck-based spawning

- [x] Confirm token pickup logic
- [x] Confirm correct crafting logic

## **D3.b — Globe-Spanning Gameplay**

**Goal:** Movement, global coordinates, infinite grid spawning/despawning.

- [x] Earth-spanning grid
- [x] Zoom in/out buttons
- [x] Memoryless rendering (cells reset when off-screen)
- [x] Player movement functionality
- [x] Directional movement buttons
- [x] Map panning follows player
- [x] Confirmed memoryless behavior

- [x] Movement boundaries (if required)
- [x] Ensure consistent despawn/respawn behavior under all zoom levels

## **D3.c — Object Persistence**

**Goal:** Use Flyweight + Memento patterns so cells keep state when off-screen.

- [x] Flyweight pattern
- [x] Memento pattern
- [x] Persistent memory?

## **D3.d — Persistent Save Data (next assignment)**

**Goal:** Store persistent memory of modified cells across page loads.

- [x] Designed system with `Map<cell, token>` so storing state will be one function call
- [x] Geolocation API
- [x] Facade design pattern
- [x] Load and restore state on page open
