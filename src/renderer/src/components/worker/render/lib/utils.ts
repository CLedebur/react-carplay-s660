// Based on https://github.com/codewithpassion/foxglove-studio-h264-extension/tree/main
// MIT License
import { Bitstream, NALUStream, SPS } from './h264-utils'

type GetNaluResult = { type: NaluTypes; nalu: Uint8Array; rawNalu: Uint8Array }

enum NaluTypes {
  NDR = 1,
  IDR = 5,
  SEI = 6,
  SPS = 7,
  PPS = 8,
  AUD = 9,
}

function getNaluFromStream(
  buffer: Uint8Array,
  type: NaluTypes,
): GetNaluResult | null {
  const stream = new NALUStream(buffer, { type: 'annexB' })

  for (const nalu of stream.nalus()) {
    if (nalu?.nalu) {
      const bitstream = new Bitstream(nalu.nalu)
      bitstream.seek(3)
      const nal_unit_type = bitstream.u(5)
      if (nal_unit_type === type) {
        return { type: nal_unit_type, ...nalu }
      }
    }
  }

  return null
}

function isKeyFrame(frameData: Uint8Array): boolean {
  const idr = getNaluFromStream(frameData, NaluTypes.IDR)
  return Boolean(idr)
}

function getDecoderConfig(frameData: Uint8Array): VideoDecoderConfig | null {
  const spsNalu = getNaluFromStream(frameData, NaluTypes.SPS)
  if (spsNalu) {
    const sps = new SPS(spsNalu.nalu)
    const decoderConfig: VideoDecoderConfig = {
      codec: sps.MIME,
      codedHeight: sps.picHeight,
      codedWidth: sps.picWidth,
      // Prefer hardware decode when a backend is available, and hint the
      // decoder to minimise latency (this is a live mirror, not a media file).
      // On stock Electron on the Pi there is no HW H264 backend, so this
      // gracefully falls back to software -- but it no longer *forbids* HW on
      // hosts / patched builds that do have it (the previous value was
      // 'prefer-software', which opted out of hardware decode everywhere).
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: true,
    }
    return decoderConfig
  }
  return null
}

export { getDecoderConfig, isKeyFrame }
