#!/usr/bin/env bash
# Генерирует короткое тестовое видео в максимально совместимом формате (H.264 baseline, низкое разрешение).
# Нужно проверить, воспроизводится ли в VM вообще какое-либо видео (галерея / Instagram).
# Требуется: ffmpeg

set -e
OUT="${1:-$(dirname "$0")/test-video-vm.mp4}"

if ! command -v ffmpeg &>/dev/null; then
  echo "Установите ffmpeg (apt install ffmpeg / dnf install ffmpeg)."
  exit 1
fi

echo "Создаю тестовое видео: $OUT"
ffmpeg -y -f lavfi -i "color=c=black:s=480x320:d=3" \
  -f lavfi -i "anullsrc=r=44100:cl=stereo" -t 3 \
  -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -b:v 400k \
  -c:a aac -b:a 128k -movflags +faststart \
  "$OUT"

echo "Готово. Загрузите на VM и откройте в галерее:"
echo "  adb -s IP:5555 push \"$OUT\" /sdcard/Download/"
echo "  adb -s IP:5555 shell chmod 644 /sdcard/Download/$(basename "$OUT")"
echo "  adb -s IP:5555 shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d \"file:///sdcard/Download/$(basename "$OUT")\""
