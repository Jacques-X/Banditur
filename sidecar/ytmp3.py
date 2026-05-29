#!/usr/bin/env python3
"""
YouTube → MP3 sidecar for Banditur.

Two actions (passed as --action <search|download>):

  search   --query "video title"
           → emits: {"type": "results", "items": [...]}
           → each item: {id, title, channel, duration, thumbnail, url}

  download --url "https://..." --output-dir "/path"
           → emits: {"type": "progress", "value": <0-100>}
           → emits: {"type": "converting"}
           → emits: {"type": "done", "path": "/path/title.mp3", "title": "..."}
           → emits: {"type": "error", "message": "..."}

All output is newline-delimited JSON on stdout, flushed immediately.
"""

import json
import sys
import argparse
import os


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def do_search(query: str):
    try:
        import yt_dlp
    except ImportError:
        emit({"type": "error", "message": "yt-dlp mhux installat. Mexxi: pip install yt-dlp"})
        sys.exit(1)

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch5:{query}", download=False)
    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)

    items = []
    for entry in (info or {}).get("entries", []):
        if not entry:
            continue
        vid_id = entry.get("id", "")
        items.append({
            "id": vid_id,
            "title": entry.get("title", ""),
            "channel": entry.get("channel") or entry.get("uploader") or "",
            "duration": entry.get("duration") or 0,
            "thumbnail": entry.get("thumbnail") or f"https://i.ytimg.com/vi/{vid_id}/mqdefault.jpg",
            "url": entry.get("url") or f"https://www.youtube.com/watch?v={vid_id}",
        })

    emit({"type": "results", "items": items})


def do_download(url: str, output_dir: str):
    try:
        import yt_dlp
    except ImportError:
        emit({"type": "error", "message": "yt-dlp mhux installat. Mexxi: pip install yt-dlp"})
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    last_pct = [-1]

    def progress_hook(d):
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            if total > 0:
                pct = round(downloaded / total * 100, 1)
                if pct != last_pct[0]:
                    last_pct[0] = pct
                    emit({"type": "progress", "value": pct})
        elif status == "finished":
            emit({"type": "converting"})

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(output_dir, "%(title)s.%(ext)s"),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        "progress_hooks": [progress_hook],
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title", "audio")
            # Build the expected .mp3 path from the template
            filename = ydl.prepare_filename(info)
            mp3_path = os.path.splitext(filename)[0] + ".mp3"
            emit({"type": "done", "path": mp3_path, "title": title})
    except Exception as e:
        emit({"type": "error", "message": str(e)})
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", required=True, choices=["search", "download"])
    parser.add_argument("--query", default="")
    parser.add_argument("--url", default="")
    parser.add_argument("--output-dir", default="")
    args = parser.parse_args()

    if args.action == "search":
        if not args.query.strip():
            emit({"type": "error", "message": "Query hija vojta."})
            sys.exit(1)
        do_search(args.query.strip())
    elif args.action == "download":
        if not args.url.strip():
            emit({"type": "error", "message": "URL huwa vojt."})
            sys.exit(1)
        if not args.output_dir.strip():
            emit({"type": "error", "message": "Output dir hija vojta."})
            sys.exit(1)
        do_download(args.url.strip(), args.output_dir.strip())


if __name__ == "__main__":
    main()
