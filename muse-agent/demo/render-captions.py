"""Render video-only caption overlays. Inputs contain caption text, never credentials."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def render(captions_path: Path, output_dir: Path) -> None:
    candidates = [
        Path('/System/Library/Fonts/Supplemental/Arial.ttf'),
        Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf'),
        Path('/System/Library/Fonts/Helvetica.ttc'),
        Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
    ]
    font_path = next((path for path in candidates if path.is_file()), None)
    if font_path is None:
        raise SystemExit('No supported local font found for video captions.')
    font = ImageFont.truetype(str(font_path), 23)
    captions = json.loads(captions_path.read_text(encoding='utf-8'))
    if not isinstance(captions, list) or not 1 <= len(captions) <= 30:
        raise SystemExit('Expected one to thirty caption records.')
    output_dir.mkdir(parents=True, exist_ok=True)
    measuring = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
    for index, caption in enumerate(captions):
        text = caption.get('text') if isinstance(caption, dict) else None
        if not isinstance(text, str) or not text.strip() or len(text) > 500:
            raise SystemExit('A caption was empty or too long.')
        lines = []
        current = ''
        for word in text.split():
            proposed = f'{current} {word}'.strip()
            if measuring.textlength(proposed, font=font) > 1680 and current:
                lines.append(current)
                current = word
            else:
                current = proposed
        lines.append(current)
        text = '\n'.join(lines)
        bounds = measuring.multiline_textbbox((0, 0), text, font=font, spacing=7)
        width = min(1820, int(bounds[2] - bounds[0]) + 48)
        height = int(bounds[3] - bounds[1]) + 32
        image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        drawing = ImageDraw.Draw(image)
        drawing.rounded_rectangle((0, 0, width - 1, height - 1), radius=14,
                                   fill=(16, 17, 18, 238), outline=(117, 103, 81, 190), width=1)
        drawing.multiline_text((24 - bounds[0], 16 - bounds[1]), text, font=font,
                               fill=(239, 242, 239, 255), spacing=7)
        destination = output_dir / f'caption-{index}.png'
        if destination.exists():
            raise SystemExit('A caption output already exists; use a fresh temporary directory.')
        image.save(destination)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python3 render-captions.py captions.json output-directory')
    render(Path(sys.argv[1]), Path(sys.argv[2]))
