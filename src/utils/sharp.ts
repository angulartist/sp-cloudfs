import * as sharp from 'sharp'
import * as rp from 'request-promise'
import { overlayURL } from '../config'

/**
 * Resize an image buffer
 * @param width Width of the image
 * @param height Height of the image
 * @param tmpFilePath File path in /tmp/ directory
 */
export const resizeImageBuffer = async (
  width: number,
  height: number,
  imageBuffer: Buffer
): Promise<Buffer> => {
  if (!width || !height || !imageBuffer)
    throw 'resizeImageBuffer: Argument is missing.'

  return sharp(imageBuffer)
    .resize(width, height, { fit: 'inside' })
    .png()
    .toBuffer()
}

/**
 * Add an overlay (watermark) to the image buffer
 * @param imageBuffer Image buffer thrown back by the API
 */
export const overlayImageBuffer = async (
  imageBuffer: Buffer
): Promise<Buffer> => {
  if (!imageBuffer) throw 'overlayImageBuffer: No imageBuffer buffer.'

  const overlayBuffer: Buffer = await rp(overlayURL, { encoding: null })

  if (!overlayBuffer) throw 'overlayImageBuffer: No overlay buffer.'

  return sharp(imageBuffer)
    .composite([{ input: overlayBuffer, tile: true }])
    .toBuffer()
}
