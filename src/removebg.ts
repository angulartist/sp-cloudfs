import * as functions from 'firebase-functions'
import { File } from '@google-cloud/storage'
import { bucket, db } from './config'
import { randomFileName } from './helpers'
import {
  overlayImageBuffer,
  resizeImageBuffer,
  saveFileToBucket,
  getGCSSignedURL,
  removeBgApi
} from './utils'
// Models
import { Order, STATE } from './models'

/**
 * [UI] Update the order state to error.
 * @param orderRef Current order firestore document reference
 */
const setOrderError = (
  orderRef: FirebaseFirestore.DocumentReference,
  error: string = ''
) => {
  try {
    if (!orderRef) throw 'setOrderError: No document reference.'

    return orderRef.update({ state: STATE.ERROR, error })
  } catch (error) {
    throw new Error(error)
  }
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
): Promise<FirebaseFirestore.WriteResult> => {
  try {
    if (!orderRef || !imageBuffer || !fileName || !userId)
      throw 'imageManipulation: Argument is missing.'

    // GCS bucket paths
    const [watermarkPath, thumbnailPath]: File[] = [
      bucket.file(`@watermarks/${userId}/${fileName}_${randomFileName()}.png`),
      bucket.file(`@thumbnails/${userId}/${fileName}_${randomFileName()}.png`)
    ]

    if (!watermarkPath || !thumbnailPath)
      throw 'imageManipulation: GCS Path is missing.'

    const _sharp: Promise<Buffer>[] = [
      overlayImageBuffer(imageBuffer),
      resizeImageBuffer(96, 96, imageBuffer)
    ]

    const [watermarkBuffer, thumbnailBuffer]: Buffer[] = await Promise.all(
      _sharp
    )

    if (!watermarkBuffer || !thumbnailBuffer)
      throw 'imageManipulation: Buffer is missing.'

    const _gcs: any[] = [
      saveFileToBucket(watermarkPath, watermarkBuffer),
      saveFileToBucket(thumbnailPath, thumbnailBuffer),
      getGCSSignedURL(watermarkPath),
      getGCSSignedURL(thumbnailPath)
    ]

    const [, , watermarkURL, thumbnailURL]: string[] = await Promise.all(_gcs)

    if (!watermarkURL || !thumbnailURL)
      throw 'imageManipulation: Signed URL is missing.'

    return orderRef.update({
      watermarkURL,
      thumbnailURL,
      state: STATE.SUCCESS
    })
  } catch (error) {
    return setOrderError(orderRef, error)
  }
}

const saveToPrivateCollection = async (
  userId: string,
  orderId: string,
  fileName: string,
  imageBuffer: Buffer
): Promise<FirebaseFirestore.WriteResult> => {
  if (!userId || !orderId || !fileName || !imageBuffer)
    throw 'saveToPrivateCollection: Argument is missing.'

  const [privateRef, privateBucketPath]: any[] = [
    db.collection(`users/${userId}/private_images`),
    bucket.file(`@privates/${userId}/${fileName}_${randomFileName()}.png`)
  ]

  if (!privateRef || !privateBucketPath) throw 'removeBg: GCS Path is missing.'

  const _gcs: any[] = [
    saveFileToBucket(privateBucketPath, imageBuffer),
    getGCSSignedURL(privateBucketPath)
  ]

  const [, privateURL]: string[] = await Promise.all(_gcs)

  if (!privateURL) throw 'removeBg: privateURL is missing.'

  return privateRef.doc(orderId).set({ privateURL })
}

/**
 * Main functon.
 */
export const removeBg = functions
  .runWith({ memory: '1GB' })
  .firestore.document('users/{userId}/orders/{orderId}')
  .onCreate(
    async (snapShot: FirebaseFirestore.DocumentSnapshot, { params }) => {
      const { orderId, userId: initiatorId }: { [option: string]: any } = params

      const orderRef: FirebaseFirestore.DocumentReference = db.doc(
        `users/${initiatorId}/orders/${orderId}`
      )

      const {
        userId,
        originalURL,
        fileName
      }: FirebaseFirestore.DocumentData = snapShot.data() as Order

      try {
        if (!orderId || !userId || !originalURL || !fileName || !orderRef)
          throw 'removeBg: Argument is missing.'

        if (userId !== initiatorId)
          throw 'removeBg: Trying to access to a private collection.'

        const imageBuffer: Buffer = await removeBgApi(originalURL)

        if (!imageBuffer) throw 'removeBg: No imageBuffer.'

        console.log(imageBuffer)

        await saveToPrivateCollection(userId, orderId, fileName, imageBuffer)

        return imageManipulation(orderRef, userId, imageBuffer, fileName)
      } catch (error) {
        return setOrderError(orderRef, JSON.stringify(error))
      }
    }
  )
