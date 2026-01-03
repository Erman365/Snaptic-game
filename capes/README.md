# Capes Folder

Place your custom cape PNG textures in this folder.

## How to add a new cape:

1. Add your PNG file to this folder (e.g., `mycape.png`)
2. Open `game.js` and find the `CAPE_CONFIGS` object (around line 533)
3. Add a new entry like this:

```javascript
'mycape': {
    texturePath: 'capes/mycape.png',
    segments: 12,
    width: 0.6,
    length: 1.2,
    color: 0x00ff00  // Fallback color if texture fails to load
}
```

4. Add the cape option to `index.html` in the cape selector:
```html
<div class="cape-option" data-cape="mycape">✨ My Cape</div>
```

## Cape Configuration Options:

- `texturePath`: Path to your PNG file (relative to game root)
- `segments`: Number of physics segments (more = smoother but more expensive, 12 is good)
- `width`: Cape width in game units (0.6 is default)
- `length`: Cape length in game units (1.2 is default)
- `color`: Fallback color (hex format like 0xff0000 for red) if texture fails to load

## Notes:

- PNG files should be transparent where you want the cape to be see-through
- The texture will be repeated along the length of the cape
- Make sure the PNG file exists before testing, or the fallback color will be used

