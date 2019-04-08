import * as functions from 'firebase-functions'
import * as rp from 'request-promise'
import * as fs from 'fs-extra'
import * as sharp from 'sharp'
import { tmpdir } from 'os'
import { join } from 'path'
import { db, bucket, signedUrlCfg, apiOpts } from './config'
import { randomFileName, makeBucketFilePath } from './helpers'
// Models
import { STATE } from './models/state'
import { File } from '@google-cloud/storage'

// Orders firestore collection reference
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

export const imageManipulation = async (
  orderRef: FirebaseFirestore.DocumentReference,
  userId: string,
  imageBuffer: Buffer,
  fileName: string
) => {
  // Quick checks
  if (!imageBuffer || !fileName || !userId) return setOrderError(orderRef)

  // Working dir settings
  const workingDir: string = join(tmpdir(), 'sharp_editing')
  const originalFilePath: string = join(workingDir, `@original_${fileName}`)
  const watermarkFileName: string = `@watermark_${fileName}`
  const thumbnailFileName: string = `@thumbnail_${fileName}`

  // GCS bucket paths
  const watermarkBucketFilePath: File = bucket.file(
    `@watermarks/${userId}/${watermarkFileName}_${randomFileName()}.png`
  )
  const thumbnailBucketFilePath: File = bucket.file(
    `@thumbnails/${userId}/${thumbnailFileName}_${randomFileName()}.png`
  )

  try {
    // Make sure dir exist, otherwise create it
    await fs.ensureDir(workingDir)
    // Write the image buffer to the tmp/ dir
    await new Promise((resolve, reject) => {
      fs.writeFile(originalFilePath, imageBuffer, err => {
        if (err) reject(err)
        else resolve()
      })
    })

    // Some sharp magic!
    const [watermarkImageBuffer, thumbnailImageBuffer] = await Promise.all([
      buildImageBuffer(416, 352, originalFilePath),
      buildImageBuffer(96, 96, originalFilePath)
    ])

    // Upload the thumbnail back to GCS
    await Promise.all([
      saveFileToBucket(watermarkBucketFilePath, watermarkImageBuffer),
      saveFileToBucket(thumbnailBucketFilePath, thumbnailImageBuffer)
    ])

    // Get signed URLs from GCS
    const [watermarkURL, thumbnailURL] = await Promise.all([
      getGCSSignedUrl(watermarkBucketFilePath),
      getGCSSignedUrl(thumbnailBucketFilePath)
    ])

    // Delete working dir to free space
    fs.remove(workingDir)

    // Update the current order w/ the previewURL
    return orderRef.update({
      watermarkURL,
      thumbnailURL
    })
  } catch (error) {
    fs.remove(workingDir)
    return setOrderError(orderRef)
  }
}

const getGCSSignedUrl = async (bucketFilePath: File): Promise<string> => {
  const [signedURL] = await bucketFilePath.getSignedUrl(signedUrlCfg)

  return signedURL
}

const saveFileToBucket = async (
  bucketFilePath: File,
  imageBuffer: Buffer
): Promise<void> =>
  await bucketFilePath.save(imageBuffer, { contentType: 'image/png' })

const buildImageBuffer = async (
  width: number,
  height: number,
  tmpFilePath: string
): Promise<Buffer> =>
  await sharp(tmpFilePath)
    .resize(width, height, { fit: 'inside' })
    .png()
    .toBuffer()

/**
 * Main functon.
 */
export const removeBg = functions.firestore
  .document('orders/{orderId}')
  .onCreate(
    async (snapShot: FirebaseFirestore.DocumentSnapshot, { params }) => {
      // Current order ID
      const { orderId } = params
      // Current order K/V pairs
      const { userId, originalURL, fileName } = snapShot.data()
      // Current order firestore document reference
      const orderRef = ordersRef.doc(orderId)

      // [PROCESS]

      try {
        // Ask for a process
        const imageBuffer: Buffer = await rp({
          ...apiOpts,
          formData: { ...apiOpts.formData, image_url: originalURL }
        })
        // Is there any buffer thrown back?
        if (!imageBuffer) return setOrderError(orderRef)
        // Concurrent thumbnail making action
        await imageManipulation(orderRef, userId, imageBuffer, fileName)
        // Update the current order state
        return orderRef.update({
          state: STATE.SUCCESS
        })
      } catch (error) {
        // TODO: Error logging
        return setOrderError(orderRef)
      }
    }
  )
