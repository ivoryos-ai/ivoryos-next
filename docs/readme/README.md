# The README's animation

`hero.webp`, the animation at the top of the repository's README, is the promo film's "script to
platform" piece: 1280 px wide, 12 frames a second, the last frame held 1.5 s, looping. Animated
WebP rather than GIF: the same animation as a GIF is about five times the size.

```bash
ffmpeg -i 06-script-to-platform.mp4 \
  -vf "fps=12,scale=1280:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.5" \
  -c:v libwebp_anim -q:v 70 -compression_level 6 -loop 0 -an hero.webp
```

The six pictures under "What you get" are the documentation's own screenshots
(`docs-site/src/assets/screenshots/`), used where they are, so they change when those are retaken.
