#!/usr/bin/env python3
import sys
import arabic_reshaper
from bidi.algorithm import get_display

text = sys.stdin.read().strip()
reshaped = arabic_reshaper.reshape(text)
visual   = get_display(reshaped)
sys.stdout.write(visual)
