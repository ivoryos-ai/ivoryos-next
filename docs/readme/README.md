# The README's pictures

The pictures in the repository's README, made from the promo film's rendered pieces.

| File | From |
|---|---|
| `hero.webp` | The "script to platform" piece, whole: 1280 px wide, 12 frames a second, the last frame held 1.5 s, looping. |
| `feature-*.webp` | One frame per feature of the "from day one" piece, cropped to the app window (770, 105 to 1920, 1025 of the 1920 x 1080 frame), 920 px wide, corners rounded. |

Animated WebP rather than GIF: the same animation as a GIF is about five times the size.

```bash
ffmpeg -i 06-script-to-platform.mp4 \
  -vf "fps=12,scale=1280:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.5" \
  -c:v libwebp_anim -q:v 70 -compression_level 6 -loop 0 -an hero.webp
```

When the app's look changes, re-render the film's pieces from new screenshots first, then these.
