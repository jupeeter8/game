#!/bin/sh
# Make a 16 kHz mono WAV from text with the macOS voice, for Chromium's fake microphone.
#   sh e2e/mkwav.sh "Hello grandmother, how are you?" e2e/wav/hello.wav
set -e
mkdir -p "$(dirname "$2")"
say -v Daniel -o /tmp/mkwav.aiff "$1"
afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/mkwav.aiff "$2"
echo "$2"
