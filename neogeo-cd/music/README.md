# Your songs

Drop one file per slot here, named after the slot, and push. The build converts it for the CD
(44.1 kHz 16-bit stereo, levelled to about the same loudness) and puts it on the disc.

| File name | Plays on |
|---|---|
| `title.*` | title screen and menus (CD track 2) |
| `marathon.*` | Side by Side (track 3) |
| `sprint.*` | spare (track 4, not used yet) |
| `versus.*` | Versus CPU, Versus 2P and the attract demo (track 5) |
| `survival.*` | Survival (track 6) |

Any of `.mp3 .flac .ogg .opus .m4a .aac .wav`. A slot with no file keeps its chiptune placeholder.
Songs loop, so ones that end cleanly sound best. The slot names come from SPACBRACK, whose audio tools this disc uses. Keep the five together under about 70 minutes.
MP3 or FLAC keeps the repo small (GitHub refuses single files over 100 MB, about 9 minutes of WAV).
