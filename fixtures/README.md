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

## `corrupted-8s.mp4`

`sample-8s.mp4` with every byte of its `mdat` payload set to 0. It is the video the smoke's `processing failure` step uploads: validation accepts it, and processing fails on it, so the request settles `FAILED` with `PROCESSAMENTO_FALHOU`, the code only the processing path emits.

| Property | Value |
| --- | --- |
| Derived from | `sample-8s.mp4`: only the `mdat` payload changes; every box header and the `moov` box are kept byte for byte |
| Duration, as FFprobe reports it | **8 seconds**, one H.264 video stream, MP4 family (`mov,mp4,m4a,3gp,3g2,mj2`) |
| Frames FFmpeg decodes | **0** |
| Size | 39,863 bytes (the same as the sample) |
| SHA-256 | `24123d94709fc8323c7245e759f4648e60d82427e014890bfe9175ea49259454` |

### How it was made

It walks the top-level MP4 boxes (a 4-byte big-endian size, then a 4-byte type) and zeroes the bytes `[i+8, i+size)` of the `mdat` box. Python runs in a container, so nothing is needed on the host. This is the exact command, run from the repository root:

```sh
docker run --rm -v "$PWD/fixtures:/w" python:3-alpine python3 -c 'd=bytearray(open("/w/sample-8s.mp4","rb").read())
i=0
while i<len(d):
  s=int.from_bytes(d[i:i+4],"big"); t=bytes(d[i+4:i+8])
  if t==b"mdat": d[i+8:i+s]=bytes(s-8)
  i+=s
open("/w/corrupted-8s.mp4","wb").write(d)'
```

The transformation is deterministic: run on the committed sample, it reproduces the SHA-256 above whatever Python version the image carries.

### Why it fails where it does

The Worker runs FFprobe to validate and FFmpeg to extract frames (`-vf fps=1`), with the FFmpeg that `processing-worker/Dockerfile` installs. The design spiked this file with that toolchain and the Worker's exact arguments:

- **Validation accepts it.** FFprobe reads only the `moov` box, which is untouched: it exits 0 and reports the MP4 family, a duration of 8 seconds and a video stream. So the file is readable, within the duration limit, in the MP4 family and has video, and the Worker does not reject it with `FORMATO_INVALIDO`.
- **Processing fails on it.** FFmpeg decodes the `mdat` payload, which is all zeros: it fails on the first frame ("Invalid NAL unit size"), exits **69** and writes **0 frames**. The Worker fails on a non-zero exit and emits `PROCESSAMENTO_FALHOU`.
- **A second, independent cause.** Should a future FFmpeg skip undecodable frames and exit 0, it would still write 0 frames, and the ZIP builder refuses to build an archive of 0 files. The fixture keeps failing at processing unless a decoder produces frames from zeros.

If validation ever rejects it instead, the smoke's `processing failure` step fails naming `FAILED (FORMATO_INVALIDO)`; if it ever completes, the step fails naming `COMPLETED`. Neither passes unnoticed.
