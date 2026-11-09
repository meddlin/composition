#!/usr/bin/env python3
"""Runs a command and prints its peak resident memory (the largest of any child, in MB): `peak-rss.py cmd args...`."""
import resource
import subprocess
import sys

code = subprocess.run(sys.argv[1:]).returncode
print(f"peak RSS of the largest child: {resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024:.1f} MB", file=sys.stderr)
sys.exit(code)
