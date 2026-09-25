# Fixtures

## `sample-8s.mp4`

A synthetic test video. It is the source object the seed script puts in the bucket, so the Worker has a real MP4 to process before the upload path (S6) exists.

| Property | Value |
| --- | --- |
| Duration | **8 seconds** |
| Video | H.264 (`libx264`, `yuv420p`) in MP4, 320×240, 30 frames/s |
| Frames at 1 frame per second | **8** |
| Size | 39,863 bytes |
| SHA-256 | `494956e297e20a6c7fa8459504dc9a81fcf79efa428aae08a9cb05631f2d7552` |
| Content | FFmpeg's `testsrc` pattern: synthetic, so there is no licence question |

### How it was made

FFmpeg is not required on the host, so the file was generated once in a container and committed. This is the exact command, run from the repository root:

```sh
docker run --rm --platform linux/amd64 -v "$PWD/fixtures:/out" jrottenberg/ffmpeg@sha256:8ec1ee1f6a0fcd37c97725827b6b7832795c9596e3439b8da56d7700d61ae778 -f lavfi -i testsrc=duration=8:size=320x240:rate=30 -c:v libx264 -pix_fmt yuv420p /out/sample-8s.mp4
```

The image is FFmpeg 7.1, pinned by digest. A different FFmpeg build may produce different bytes; the properties in the table above are what matters, not the checksum.

### Why it is committed rather than generated

The spec first proposed generating the file at seed time. The design revised that: generating it would require FFmpeg on the host, which nothing else in this repository needs. The binary is committed instead, and this document is its reviewable surface.

### The smoke depends on these numbers

The frame count the smoke expects in the produced archive is derived from this file: 8 seconds at 1 frame per second gives **8 entries**. Replacing the fixture without changing that expectation makes the smoke fail with both numbers named, rather than passing unnoticed.
