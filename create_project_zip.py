#!/usr/bin/env python3
"""
PhotoCapture Project Zip Packager
Creates a clean, production-ready ZIP archive of the project,
automatically excluding `.venv`, `node_modules`, build artifacts,
temporary files, and caches.

Usage:
    python create_project_zip.py
    python create_project_zip.py --output my_backup.zip
    python create_project_zip.py --include-scratch
"""

import argparse
import os
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path

# Ensure UTF-8 output support on Windows command prompt
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Directories to exclude anywhere in the tree
DEFAULT_EXCLUDE_DIRS = {
    "node_modules",
    ".venv",
    "venv",
    "env",
    ".git",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
    ".turbo",
    ".freebuff",
    "scratch",
    "outputs",
    "test-results",
}

# File extensions or specific suffixes to exclude
DEFAULT_EXCLUDE_EXTS = {
    ".pyc",
    ".pyo",
    ".pyd",
    ".tsbuildinfo",
    ".log",
    ".zip",
    ".db-wal",
    ".db-shm",
    ".db-journal",
}

# Specific filenames to exclude
DEFAULT_EXCLUDE_FILES = {
    ".DS_Store",
    "Thumbs.db",
}


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Pack project into a zip file excluding .venv, node_modules, and cache files."
    )
    parser.add_argument(
        "-o",
        "--output",
        type=str,
        default=None,
        help="Custom output zip filename (default: Camera_App_YYYYMMDD_HHMMSS.zip)",
    )
    parser.add_argument(
        "--include-scratch",
        action="store_true",
        help="Include scratch/ folder in the zip (excluded by default)",
    )
    parser.add_argument(
        "--include-outputs",
        action="store_true",
        help="Include outputs/ folder in the zip (excluded by default)",
    )
    parser.add_argument(
        "--include-git",
        action="store_true",
        help="Include .git/ repository in the zip (excluded by default)",
    )
    return parser.parse_args()


def should_exclude_dir(dir_name: str, rel_path: str, args) -> bool:
    name_lower = dir_name.lower()
    
    if name_lower in ("node_modules", ".venv", "venv", "env"):
        return True
    if name_lower in ("__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"):
        return True
    if name_lower in ("dist", "build", ".turbo", ".freebuff", "test-results"):
        return True
    if name_lower.endswith(".egg-info"):
        return True

    if name_lower == ".git" and not args.include_git:
        return True
    if name_lower == "scratch" and not args.include_scratch:
        return True
    if name_lower == "outputs" and not args.include_outputs:
        return True

    return False


def should_exclude_file(file_name: str, target_zip_name: str) -> bool:
    name_lower = file_name.lower()

    # Never include the archive itself or other zip archives
    if name_lower == target_zip_name.lower() or name_lower.endswith(".zip"):
        return True

    # Check file extensions
    for ext in DEFAULT_EXCLUDE_EXTS:
        if name_lower.endswith(ext):
            return True

    # Check specific file names
    if file_name in DEFAULT_EXCLUDE_FILES:
        return True

    return False


def format_size(bytes_val: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_val < 1024.0 or unit == "GB":
            return f"{bytes_val:.2f} {unit}"
        bytes_val /= 1024.0
    return f"{bytes_val:.2f} GB"


def create_zip():
    args = parse_arguments()
    start_time = time.perf_counter()

    project_root = Path(__file__).resolve().parent
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    if args.output:
        out_path = Path(args.output)
        if not out_path.is_absolute():
            out_path = project_root / out_path
    else:
        out_path = project_root / f"Camera_App_{timestamp}.zip"

    target_zip_name = out_path.name

    print("=" * 65)
    print("  Creating Project ZIP Archive")
    print(f"  Source Root : {project_root}")
    print(f"  Destination : {out_path}")
    print(f"  Exclusions  : node_modules, .venv, git, caches, test artifacts")
    print("=" * 65)

    files_added = 0
    total_uncompressed_bytes = 0
    skipped_dirs = set()

    with zipfile.ZipFile(out_path, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zip_file:
        for root, dirs, files in os.walk(project_root):
            rel_root = os.path.relpath(root, project_root)

            # Filter directories in-place to prevent os.walk from descending into them
            orig_dirs = list(dirs)
            dirs.clear()
            for d in orig_dirs:
                rel_d = os.path.normpath(os.path.join(rel_root, d)) if rel_root != "." else d
                if should_exclude_dir(d, rel_d, args):
                    skipped_dirs.add(d)
                else:
                    dirs.append(d)

            for f in files:
                if should_exclude_file(f, target_zip_name):
                    continue

                full_path = os.path.join(root, f)
                arc_name = os.path.relpath(full_path, project_root)

                try:
                    file_size = os.path.getsize(full_path)
                    zip_file.write(full_path, arc_name)
                    files_added += 1
                    total_uncompressed_bytes += file_size
                except (PermissionError, FileNotFoundError) as err:
                    print(f"  [WARN] Skipping inaccessible file {arc_name}: {err}")

    elapsed = time.perf_counter() - start_time
    zip_size = os.path.getsize(out_path)
    ratio = (1.0 - (zip_size / total_uncompressed_bytes)) * 100 if total_uncompressed_bytes > 0 else 0

    print("\n" + "=" * 65)
    print("  ZIP Archive Created Successfully!")
    print("=" * 65)
    print(f"  File Name         : {out_path.name}")
    print(f"  Full Path         : {out_path}")
    print(f"  Total Files Added : {files_added:,}")
    print(f"  Uncompressed Size : {format_size(total_uncompressed_bytes)}")
    print(f"  Compressed Size   : {format_size(zip_size)} ({ratio:.1f}% space saved)")
    print(f"  Time Elapsed      : {elapsed:.2f} seconds")
    print(f"  Skipped Categories: {', '.join(sorted(skipped_dirs))}")
    print("=" * 65)

    return str(out_path)


if __name__ == "__main__":
    create_zip()
