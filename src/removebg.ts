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

/**
 * Generate a 96*96 thumbnail image.
 * @param orderRef Current order firestore document reference
 * @param imageBuffer Background-free image buffer
 * @param fileName Current order fileName
 */
const makeThumb = async (
  orderRef: FirebaseFirestore.DocumentReference,
  imageBuffer: Buffer,
  fileName: string
) => {
  const workingDir = join(tmpdir(), 'thumbs')
  const thumbFileName = `@thumb_${fileName}`
  const tmpFilePath = join(workingDir, `@removedbg_${fileName}`)
  const bucketFilePath = bucket.file(
    `@thumbs/${thumbFileName}_${randomFileName()}.png`
  )

  // Quick checks
  if (!imageBuffer || !fileName) return setOrderError(orderRef)

  try {
    // Make sure dir exist, otherwise create it
    await fs.ensureDir(workingDir)
    // Write the image buffer to the tmp/ dir
    await new Promise((resolve, reject) => {
      fs.writeFile(tmpFilePath, imageBuffer, err => {
        if (err) reject(err)
        else resolve()
      })
    })
    // Resize the image and return back a new buffer
    const thumbBuffer = await sharp(tmpFilePath)
      .resize(96, 96)
      .png()
      .toBuffer()
    // Delete working dir to free space
    fs.remove(workingDir)
    // Upload the thumbnail back to GCS
    await bucketFilePath.save(thumbBuffer, { contentType: 'image/png' })
    // Grab a signed URL link.
    const [signedURL] = await bucketFilePath.getSignedUrl(signedUrlCfg)
    // Update the current order w/ the previewURL
    return orderRef.update({
      previewURL: signedURL
    })
  } catch (error) {
    // TODO: Error logging
    return setOrderError(orderRef)
  }
}

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
      try {
        // Ask for a process
        const imageBuffer: Buffer = await rp({
          ...apiOpts,
          formData: { ...apiOpts.formData, image_url: originalURL }
        })
        // Is there any buffer thrown back?
        if (!imageBuffer) return setOrderError(orderRef)
        // Concurrent thumbnail making action
        makeThumb(orderRef, imageBuffer, fileName)
        // File path where the file gonna be stored in GCS
        const bucketFilePath = makeBucketFilePath(userId, fileName)
        // Upload the new buffer back to GCS
        await bucketFilePath.save(imageBuffer, {
          contentType: 'image/png'
        })
        // Grab a signed URL link
        const [signedURL] = await bucketFilePath.getSignedUrl(signedUrlCfg)
        // Update the current order state
        return orderRef.update({
          downloadURL: signedURL,
          state: STATE.SUCCESS
        })
      } catch (error) {
        // TODO: Error logging
        return setOrderError(orderRef)
      }
    }
  )
