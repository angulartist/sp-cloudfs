import * as functions from 'firebase-functions'
import { File } from '@google-cloud/storage'
import * as rp from 'request-promise'
import * as fs from 'fs-extra'
import * as sharp from 'sharp'
import { tmpdir } from 'os'
import { join } from 'path'
import { db, bucket, signedUrlCfg, apiOpts } from './config'
import { randomFileName, makeBucketFilePath } from './helpers'

import { STATE } from './models/state'

const ordersRef: FirebaseFirestore.CollectionReference = db.collection('orders')

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
  tmpFilePath: string
): Promise<Buffer> =>
  await sharp(tmpFilePath)
    .resize(width, height, { fit: 'inside' })
    .png()
    .toBuffer()

/**
 * Add a watermark to an image buffer
 * @param tmpFilePath File path in /tmp/ directory
 */
const overlayImageBuffer = async (tmpFilePath: string): Promise<Buffer> =>
  await sharp(tmpFilePath)
    .blur()
    .toBuffer()

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

  const workingDir: string = join(tmpdir(), 'sharp_editing')
  const originalFilePath: string = join(workingDir, `@original_${fileName}`)
  const watermarkFileName: string = `@watermark_${fileName}`
  const thumbnailFileName: string = `@thumbnail_${fileName}`

  const watermarkBucketFilePath: File = bucket.file(
    `@watermarks/${userId}/${watermarkFileName}_${randomFileName()}.png`
  )
  const thumbnailBucketFilePath: File = bucket.file(
    `@thumbnails/${userId}/${thumbnailFileName}_${randomFileName()}.png`
  )

  try {
    await fs.ensureDir(workingDir)

    await new Promise((resolve, reject) => {
      fs.writeFile(originalFilePath, imageBuffer, err => {
        if (err) reject(err)
        else resolve()
      })
    })

    const [watermarkImageBuffer, thumbnailImageBuffer] = await Promise.all([
      overlayImageBuffer(originalFilePath),
      resizeImageBuffer(96, 96, originalFilePath)
    ])

    const [watermarkURL, thumbnailURL] = await Promise.all([
      getGCSSignedUrl(watermarkBucketFilePath),
      getGCSSignedUrl(thumbnailBucketFilePath),
      saveFileToBucket(watermarkBucketFilePath, watermarkImageBuffer),
      saveFileToBucket(thumbnailBucketFilePath, thumbnailImageBuffer)
    ])

    fs.remove(workingDir)

    return orderRef.update({
      watermarkURL,
      thumbnailURL,
      state: STATE.SUCCESS
    })
  } catch (error) {
    fs.remove(workingDir)
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
