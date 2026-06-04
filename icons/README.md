# Icons

This directory contains SVG placeholder icons for the extension.

## Required PNG icons (for Chrome Web Store publishing):

- `icon16.png` - 16x16 pixels (toolbar icon)
- `icon48.png` - 48x48 pixels (extension management page)
- `icon128.png` - 128x128 pixels (Chrome Web Store)

## Design suggestion:

- Use Crunchyroll's orange (#f47521) as primary color
- Simple "CC" (Crunchyroll Captions) or subtitle icon
- Ensure visibility on both light and dark themes

## Converting SVG to PNG:

You can use online tools like https://cloudconvert.com/svg-to-png or ImageMagick:

```bash
magick convert -background none icon16.svg -resize 16x16 icon16.png
magick convert -background none icon48.svg -resize 48x48 icon48.png
magick convert -background none icon128.svg -resize 128x128 icon128.png
```

Or use any image editor (GIMP, Photoshop, Figma, etc.) to create proper PNG icons.
