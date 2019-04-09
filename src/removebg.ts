import * as functions from 'firebase-functions'
import { File } from '@google-cloud/storage'
import * as rp from 'request-promise'
import * as sharp from 'sharp'
import {
  db,
  bucket,
  signedUrlCfg,
  apiOpts,
  overlayURL,
  ordersRef
} from './config'
import { randomFileName } from './helpers'
// Models
import { STATE } from './models/state'

/**
 * [UI] Update the order state to error.
 * @param orderRef Current order firestore document reference
 */
const setOrderError = (orderRef: FirebaseFirestore.DocumentReference) => {
  try {
    return orderRef.update({ state: STATE.ERROR })
  } catch (error) {
    throw new Error(error)
  }
}

/**
 * Get a signed URL from App Engine
 * @param bucketFilePath File path in GCS project bucket
 */
const getGCSSignedUrl = async (bucketFilePath: File): Promise<string> => {
  const [signedURL] = await bucketFilePath.getSignedUrl(signedUrlCfg)
  return signedURL
}

/**
 * Upload a file to GCS for a given path
 * @param bucketFilePath File path in GCS project bucket
 * @param imageBuffer Raw image data
 */
const saveFileToBucket = async (
  bucketFilePath: File,
  imageBuffer: Buffer
): Promise<void> =>
  await bucketFilePath.save(imageBuffer, { contentType: 'image/png' })

/**
 * Resize an image buffer
 * @param width Width of the image
 * @param height Height of the image
 * @param tmpFilePath File path in /tmp/ directory
 */
const resizeImageBuffer = async (
  width: number,
  height: number,
  imageBuffer: Buffer
): Promise<Buffer> =>
  sharp(imageBuffer)
    .resize(width, height, { fit: 'inside' })
    .png()
    .toBuffer()

/**
 * Add an overlay (watermark) to the image buffer
 * @param imageBuffer Image buffer thrown back by the API
 */
const overlayImageBuffer = async (imageBuffer: Buffer): Promise<Buffer> => {
  const overlayBuffer = await rp(overlayURL, { encoding: null })

  if (overlayBuffer) {
    return sharp(imageBuffer)
      .composite([{ input: overlayBuffer, tile: true }])
      .toBuffer()
  }
}

/**
 * Calculate image buffer dimensions and calculate the price
 * @param imageBuffer Image buffer thrown back by the API
 */
const calcImageCost = async (imageBuffer: Buffer) => {
  const imagePipeline = sharp(imageBuffer)
  const { width, height } = await imagePipeline.metadata()
}

/**
 * Generate a thumbnail and a watermarked and then upload them to GCS
 * @param orderRef Current order firestore document reference
 * @param userId User ID who has instanciate the order
 * @param imageBuffer Image buffer thrown back by the API
 * @param fileName Original file name
 */
export const imageManipulation = async (
  orderRef: FirebaseFirestore.DocumentReference,
  userId: string,
  imageBuffer: Buffer,
  fileName: string
) => {
  if (!imageBuffer || !fileName || !userId) return setOrderError(orderRef)

  // GCS bucket paths
  const [watermarkPath, thumbnailPath]: File[] = [
    bucket.file(`@watermarks/${userId}/${fileName}_${randomFileName()}.png`),
    bucket.file(`@thumbnails/${userId}/${fileName}_${randomFileName()}.png`)
  ]

  try {
    const sharp$: Promise<Buffer>[] = [
      overlayImageBuffer(imageBuffer),
      resizeImageBuffer(96, 96, imageBuffer)
    ]

    const [watermarkBuffer, thumbnailBuffer]: Buffer[] = await Promise.all(
      sharp$
    )

    const gcs$: any[] = [
      saveFileToBucket(watermarkPath, watermarkBuffer),
      saveFileToBucket(thumbnailPath, thumbnailBuffer),
      getGCSSignedUrl(watermarkPath),
      getGCSSignedUrl(thumbnailPath)
    ]

    const [, , watermarkURL, thumbnailURL] = await Promise.all(gcs$)

    return orderRef.update({
      watermarkURL,
      thumbnailURL,
      state: STATE.SUCCESS
    })
  } catch (error) {
    console.info(error)
    return setOrderError(orderRef)
  }
}

/**
 * Main functon.
 */
export const removeBg = functions
  .runWith({ memory: '1GB' })
  .firestore.document('orders/{orderId}')
  .onCreate(
    async (snapShot: FirebaseFirestore.DocumentSnapshot, { params }) => {
      const { orderId } = params
      const { userId, originalURL, fileName } = snapShot.data()
      const orderRef = ordersRef.doc(orderId)

      try {
        const imageBuffer: Buffer = await rp({
          ...apiOpts,
          formData: { ...apiOpts.formData, image_url: originalURL }
        })

        if (!imageBuffer) return setOrderError(orderRef)

        return imageManipulation(orderRef, userId, imageBuffer, fileName)
      } catch (error) {
        return setOrderError(orderRef)
      }
    }
  )
