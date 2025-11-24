# CMPM 121 D3 Project

After the major refactoring from the previous commit, this game featues a token system that allows the user to explore different parts of the map near our classroom. Player collects tokens and crafts them to to obtain higher numbered tokens. 2+2 = 4, and 4+4 will result in the player obtaining an 8. The player wins when a value of 16 or higher is obtained.

The game now supports **persistent game state** using the browser's `localStorage` API, allowing players to close and reopen the page without losing progress (location, held token, and collected/placed tokens are saved). Player movement control has been abstracted using the **Facade design pattern** to support multiple input methods. Players can now move their character using **real-world movement** tracked by the browser's Geolocation API, or switch back to the traditional on-screen buttons and keyboard. A "New Game" option is also available to reset all saved progress.
